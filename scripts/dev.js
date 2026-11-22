// `npm start` for ShowTrak Server and ShowTrak Timers: build once, then rebuild
// only what an edit touches.
//
// Each kind of source has its own incremental watcher, so a CSS tweak reloads
// the window instead of restarting the app (and with it every connected client,
// running timer and the open show's live state):
//
//   main process (src/**/*.ts)    tsc --watch,    -> restart Electron
//                                 then the bundle (scripts/build-main.js)
//   renderer, splash window,      esbuild watch   -> reload the window
//   service worker
//   markup / CSS / static assets  copy on change  -> reload the window
//   shared code (shared/src)      build:shared    -> tsc and esbuild pick it up
//
// The window reload is done by the app itself (@showtrak/protocol/electron-main's
// StartDevReload, turned on by SHOWTRAK_DEV_RELOAD=1 here) when it sees dist/UI
// change, so the main process, and everything connected to it, survives a
// renderer edit. Renderer type errors are reported by --noEmit watchers but
// never block a reload; CI and the pre-commit hook enforce them.
//
// `npm start -- --no-app` builds and watches without launching Electron, for
// when another instance already holds the app's single-instance lock.
//
// For a clean production build use `npm run build`.
//
// The app's scripts/dev.js:
//   require('../shared/scripts/dev').main({
//     root: path.resolve(__dirname, '..'),
//     renderer: require('./build-renderer'),
//     rendererTsconfigs: ['tsconfig.renderer.json', 'tsconfig.preloader.json', 'tsconfig.service-worker.json'],
//     assetDirs: ['src/UI'],                            // Timers: ['src/UI', 'src/WebDashboard']
//     assetScripts: ['copy-assets.js', 'build-webui.js'], // Timers: ['copy-assets.js']
//   });
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
/** Read by StartDevReload in @showtrak/protocol/electron-main. */
const DEV_RELOAD_ENV = 'SHOWTRAK_DEV_RELOAD';

function log(message) {
  console.log(`[dev] ${message}`);
}

// Coalesce bursts of file events (an editor save is often several) into one run.
function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  };
}

/**
 * What a change under an asset folder needs, from its path relative to that
 * folder ('/'-separated): 'ignore' (esbuild bundles it, or build-css writes
 * it), 'css' (a stylesheet part: rebuild main.css, then copy), or 'copy'.
 * @param {string | null} rel
 */
function classifyAssetChange(rel) {
  if (!rel) return 'copy';
  if (rel.startsWith('js/app/') || rel === 'css/main.css' || rel.endsWith('.ts')) return 'ignore';
  if (rel.startsWith('css/parts/')) return 'css';
  return 'copy';
}

/**
 * Whether a change under shared/src needs `npm run build:shared`: the compiled
 * entry points' TypeScript. The ambient .d.ts protocol types are read from
 * source by the app's own tsc and esbuild, which see their changes directly.
 * @param {string | null} file
 */
function isSharedSourceChange(file) {
  return !!file && file.endsWith('.ts') && !file.endsWith('.d.ts');
}

/**
 * @param {{
 *   root: string,
 *   renderer: { BUNDLES: object[], bundleOptions: (bundle: object) => object },
 *   rendererTsconfigs: string[],
 *   assetDirs?: string[],
 *   assetScripts?: string[],
 *   argv?: string[],
 * }} options
 *   root: the app's root folder. renderer: the app's scripts/build-renderer.js.
 *   rendererTsconfigs: the typecheck-only programs of what esbuild bundles.
 *   assetDirs: folders (from root) whose markup and assets are copied into
 *   dist on change. assetScripts: the app's scripts run, in order, after such
 *   a change (after build-css.js when a stylesheet part changed).
 */
function main({
  root,
  renderer,
  rendererTsconfigs,
  assetDirs = ['src/UI'],
  assetScripts = ['copy-assets.js'],
  argv = process.argv.slice(2),
}) {
  const NO_APP = argv.includes('--no-app');
  const TSC = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');

  function runScript(script) {
    return spawnSync(process.execPath, [path.join(root, 'scripts', script)], {
      cwd: root,
      stdio: 'inherit',
    }).status;
  }

  // --- Electron -------------------------------------------------------------

  let electron = null;
  let restarting = false;
  let shuttingDown = false;

  function startElectron() {
    if (NO_APP) return;
    // This shell may export ELECTRON_RUN_AS_NODE, which would run the app as
    // plain Node with no window at all.
    const env = { ...process.env, [DEV_RELOAD_ENV]: '1' };
    delete env.ELECTRON_RUN_AS_NODE;
    electron = spawn(require('electron'), ['.'], { cwd: root, stdio: 'inherit', env });
    electron.on('exit', (code) => {
      electron = null;
      if (restarting || shuttingDown) return;
      // The operator quit the app: end the session, as electron-forge start did.
      log(`Electron exited (${code == null ? 'signal' : code}); stopping.`);
      shutdown(0);
    });
  }

  function restartElectron() {
    if (NO_APP) return;
    if (!electron) {
      startElectron();
      return;
    }
    restarting = true;
    const old = electron;
    const kill = setTimeout(() => old.kill('SIGKILL'), 5000);
    old.once('exit', () => {
      clearTimeout(kill);
      restarting = false;
      startElectron();
    });
    old.kill('SIGTERM');
  }

  // --- Watchers -------------------------------------------------------------

  const children = [];

  // Resolves after tsc's first pass, so Electron never starts while that pass
  // is still rewriting dist/.
  function watchMainProcess() {
    let firstPass;
    const ready = new Promise((resolve) => {
      firstPass = resolve;
    });
    const child = spawn(
      process.execPath,
      [TSC, '-p', 'tsconfig.json', '--watch', '--preserveWatchOutput'],
      { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] }
    );
    children.push(child);
    let initial = true;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (text) => {
      for (const line of text.split(/\r?\n/)) if (line.trim()) console.log(`[tsc] ${line}`);
      const match = /Found (\d+) errors?\. Watching for file changes/.exec(text);
      if (!match) return;
      if (initial) {
        // The first pass only re-confirms the full build that already ran.
        initial = false;
        firstPass();
        return;
      }
      if (match[1] === '0') {
        // The app runs the bundle (package.json "main" -> dist/boot.js), so the
        // fresh per-file output is bundled before the restart picks it up.
        if (runScript('build-main.js') !== 0) {
          log('Bundling the main process failed; keeping the running app.');
          return;
        }
        log('Main process rebuilt; restarting Electron.');
        restartElectron();
      } else {
        log('Main process has type errors; keeping the running app.');
      }
    });
    return ready;
  }

  function watchRendererTypes() {
    for (const tsconfig of rendererTsconfigs) {
      const child = spawn(
        process.execPath,
        [TSC, '-p', tsconfig, '--noEmit', '--watch', '--preserveWatchOutput'],
        { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] }
      );
      children.push(child);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (text) => {
        // Only surface problems; a clean pass is the normal case and is noise.
        if (!/error TS|Found [1-9]\d* errors?/.test(text)) return;
        for (const line of text.split(/\r?\n/)) {
          if (line.trim()) console.log(`[renderer-types] ${line}`);
        }
      });
    }
  }

  async function watchRendererBundles() {
    const esbuild = require('esbuild');
    const contexts = [];
    for (const bundle of renderer.BUNDLES) {
      const ctx = await esbuild.context({ ...renderer.bundleOptions(bundle), logLevel: 'warning' });
      await ctx.watch();
      contexts.push(ctx);
    }
    return contexts;
  }

  // Markup, CSS parts and static assets: copy into dist, which the app's own
  // watcher turns into a reload.
  function watchStaticAssets() {
    let cssDirty = false;
    const sync = debounce(() => {
      if (cssDirty) {
        cssDirty = false;
        runScript('build-css.js');
      }
      for (const script of assetScripts) runScript(script);
    }, 150);
    return assetDirs.map((dir) =>
      fs.watch(path.join(root, dir), { recursive: true }, (_event, file) => {
        const change = classifyAssetChange(file ? file.split(path.sep).join('/') : null);
        if (change === 'ignore') return;
        if (change === 'css') cssDirty = true;
        sync();
      })
    );
  }

  function watchSharedSources() {
    const sources = path.join(root, 'shared', 'src');
    if (!fs.existsSync(sources)) return null;
    const rebuild = debounce(() => {
      log('Shared code changed; rebuilding shared/.');
      spawnSync(NPM, ['run', 'build:shared'], { cwd: root, stdio: 'inherit', shell: true });
    }, 150);
    return fs.watch(sources, { recursive: true }, (_event, file) => {
      if (isSharedSourceChange(file)) rebuild();
    });
  }

  // --- Lifecycle ------------------------------------------------------------

  let esbuildContexts = [];
  const fsWatchers = [];

  function shutdown(code) {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const watcher of fsWatchers) watcher.close();
    for (const ctx of esbuildContexts) void ctx.dispose();
    for (const child of children) child.kill();
    if (electron) electron.kill('SIGTERM');
    process.exitCode = code;
  }

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));

  async function start() {
    log('Full build...');
    const built = spawnSync(NPM, ['run', 'build'], { cwd: root, stdio: 'inherit', shell: true });
    if (built.status !== 0) {
      log('Initial build failed; fix the errors above and run `npm start` again.');
      process.exit(built.status || 1);
    }

    const mainReady = watchMainProcess();
    watchRendererTypes();
    esbuildContexts = await watchRendererBundles();
    fsWatchers.push(...watchStaticAssets());
    const shared = watchSharedSources();
    if (shared) fsWatchers.push(shared);

    await mainReady;
    startElectron();
    log(
      NO_APP
        ? 'Watching (--no-app: nothing is launched).'
        : 'Watching. Renderer edits reload the window; main-process edits restart the app.'
    );
  }

  return start().catch((err) => {
    console.error('[dev] Failed:', err);
    shutdown(1);
  });
}

module.exports = { main, classifyAssetChange, isSharedSourceChange, DEV_RELOAD_ENV };
