// Bundles an app's Electron main process into one file: dist/main.bundle.js
// (ShowTrak Server and ShowTrak Timers).
//
// tsc (the app's tsconfig.json) compiles the main process one file per module
// into dist/, which is what the test suite loads. The app itself boots from one
// bundle instead: dist/boot.js (src/boot.ts) enables V8's compile cache and then
// requires this bundle, so the whole main process is parsed once and cached
// rather than resolved file by file at launch (for the Server, ~540 of its own
// modules plus every file of Express, Socket.IO and the device libraries; the
// bundle took its synchronous start-up from ~100 ms to ~60 ms).
//
// The input is tsc's CommonJS OUTPUT (dist/entry.js, which requires dist/main.js
// unless it is a Squirrel install run), not the TypeScript sources: tsc emits
// each `import` as a require() at the point it appears, and main.ts depends on
// that order (app-data folders and the process guards are set up before the
// modules that open the database or bind sockets are loaded). Bundled as ES
// modules, esbuild would hoist every import above that code. Bundling the
// CommonJS output keeps each module wrapped and evaluated exactly when it is
// first required. The shared code (@showtrak/protocol/runtime, /common,
// /electron) is bundled in with it, from shared/dist.
//
// Kept external (loaded from node_modules at runtime):
//   electron                   provided by the runtime
//   bufferutil, utf-8-validate optional native speed-ups ws tries to load
//   sqlite3                    native addon (unpacked from the asar by
//                              plugin-auto-unpack-natives)
//   electron-updater           large and only ever required lazily, on the
//                              first update check of a packaged build
//                              (@showtrak/protocol/electron's updater)
//   ...and whatever else the app names (the Server: mqtt, also lazy).
//
// An external is resolved from dist/ at runtime, so it must be a top-level
// package in node_modules, in the one version everything uses. A package only
// installed nested (iconv-lite under body-parser) or in several versions
// (mime-db) has to stay bundled; build() checks the required externals resolve.
//
// The app's scripts/build-main.js:
//   const bundle = require('../shared/scripts/build-main').createMainBundle({
//     root: path.resolve(__dirname, '..'),
//     requiredExternals: ['sqlite3', 'electron-updater', 'mqtt'],
//   });
//   module.exports = { mainBundleOptions: bundle.mainBundleOptions, MAIN_BUNDLE: bundle.MAIN_BUNDLE };
//   if (require.main === module) bundle.main();
const fs = require('node:fs');
const path = require('node:path');

// Externals that are not the app's dependencies: the runtime's, or optional.
const RUNTIME_EXTERNALS = ['electron', 'electron/*', 'bufferutil', 'utf-8-validate'];

// Socket.IO serves its browser client (/socket.io/socket.io.js, which the
// Server's older integrations and the Timers' Web Dashboard load) from
// `path.join(__dirname, "../client-dist/")`. Inside the bundle __dirname is
// dist/, so point that one file's __dirname back at the installed package,
// resolved at runtime. Inert for an app that does not bundle socket.io.
const socketIoClientDist = {
  name: 'socket.io-client-dist',
  setup(build) {
    build.onLoad({ filter: /[\\/]socket\.io[\\/]dist[\\/]index\.js$/ }, async (args) => {
      const Source = await fs.promises.readFile(args.path, 'utf8');
      if (!Source.includes('__dirname')) return undefined;
      return {
        contents:
          'var __socketIoDistDir = require("path").dirname(require.resolve("socket.io"));\n' +
          Source.replace(/\b__dirname\b/g, '__socketIoDistDir'),
        loader: 'js',
        resolveDir: path.dirname(args.path),
      };
    });
  },
};

/**
 * @param {{ root: string, requiredExternals?: string[] }} options
 *   root: the app's root folder. requiredExternals: the app's dependencies
 *   loaded from node_modules rather than bundled (see above); each must
 *   resolve from dist/.
 */
function createMainBundle({ root, requiredExternals = ['sqlite3', 'electron-updater'] }) {
  const ENTRY = path.join(root, 'dist', 'entry.js');
  const MAIN_BUNDLE = path.join(root, 'dist', 'main.bundle.js');
  const external = [...RUNTIME_EXTERNALS, ...requiredExternals];

  // esbuild options for the bundle. Also used by the dev script, whose
  // rebuilds must produce exactly what a full build does.
  function mainBundleOptions() {
    return {
      entryPoints: [ENTRY],
      outfile: MAIN_BUNDLE,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'es2022',
      external: [...external],
      // Lets modules that resolve files relative to themselves tell the bundle
      // (where every module's __dirname is dist/) from the per-file build. See
      // the apps' src/Modules/Config/dist-root.ts.
      define: { __SHOWTRAK_BUNDLED__: 'true' },
      // Not minified: stack traces in the log files stay readable. The source
      // map chains through tsc's maps back to the TypeScript.
      sourcemap: 'linked',
      keepNames: true,
      legalComments: 'none',
      logLevel: 'warning',
      // The socket.io plugin's require.resolve is meant for runtime.
      logOverride: { 'require-resolve-not-external': 'silent' },
      plugins: [socketIoClientDist],
    };
  }

  async function build() {
    for (const Name of requiredExternals) {
      try {
        require.resolve(Name, { paths: [path.dirname(MAIN_BUNDLE)] });
      } catch {
        throw new Error(`External "${Name}" does not resolve from dist/; it must be bundled`);
      }
    }
    const esbuild = require('esbuild');
    const StartedAt = Date.now();
    await esbuild.build(mainBundleOptions());
    const Size = fs.statSync(MAIN_BUNDLE).size;
    console.log(
      `[build-main] Bundled the main process -> ${path.relative(root, MAIN_BUNDLE)} ` +
        `(${(Size / 1024 / 1024).toFixed(1)} MB, ${Date.now() - StartedAt} ms)`
    );
  }

  /** `node scripts/build-main.js`: build, or fail the build. */
  function main() {
    return build().catch((err) => {
      console.error('[build-main] Failed:', err);
      process.exit(1);
    });
  }

  return { MAIN_BUNDLE, mainBundleOptions, build, main };
}

module.exports = { createMainBundle, RUNTIME_EXTERNALS };
