// The esbuild option builders: scripts/build-main.js (the main-process bundle)
// and scripts/build-renderer.js (each browser-side bundle), with ShowTrak
// Server's and ShowTrak Timers' configurations. Only the options are built
// here: nothing is bundled, so esbuild is not needed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createMainBundle, RUNTIME_EXTERNALS } = require('../../scripts/build-main');
const Renderer = require('../../scripts/build-renderer');

function makeRoot(t, version = '3.36.1') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'st-protocol-bundles-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version }));
  return root;
}

// --- build-main ---------------------------------------------------------------

test('the main bundle is dist/entry.js bundled to dist/main.bundle.js, for Node, as CommonJS', () => {
  const root = path.resolve('/app');
  const { MAIN_BUNDLE, mainBundleOptions } = createMainBundle({ root });
  const Options = mainBundleOptions();
  assert.equal(MAIN_BUNDLE, path.join(root, 'dist', 'main.bundle.js'));
  assert.deepEqual(Options.entryPoints, [path.join(root, 'dist', 'entry.js')]);
  assert.equal(Options.outfile, MAIN_BUNDLE);
  assert.equal(Options.platform, 'node');
  assert.equal(Options.format, 'cjs');
  assert.equal(Options.bundle, true);
  // Readable stack traces in the log files.
  assert.equal(Options.keepNames, true);
  assert.equal(Options.minify, undefined);
  assert.equal(Options.sourcemap, 'linked');
  // dist-root.ts tells the bundle from the per-file build by this.
  assert.deepEqual(Options.define, { __SHOWTRAK_BUNDLED__: 'true' });
  assert.deepEqual(
    Options.plugins.map((P) => P.name),
    ['socket.io-client-dist']
  );
});

test('each app keeps the runtime’s modules and its own lazy dependencies external', () => {
  const Server = createMainBundle({
    root: '/server',
    requiredExternals: ['sqlite3', 'electron-updater', 'mqtt'],
  }).mainBundleOptions();
  const Timers = createMainBundle({ root: '/timers' }).mainBundleOptions();
  assert.deepEqual(RUNTIME_EXTERNALS, ['electron', 'electron/*', 'bufferutil', 'utf-8-validate']);
  assert.deepEqual(Server.external.sort(), [
    'bufferutil',
    'electron',
    'electron-updater',
    'electron/*',
    'mqtt',
    'sqlite3',
    'utf-8-validate',
  ]);
  assert.deepEqual(Timers.external.sort(), [
    'bufferutil',
    'electron',
    'electron-updater',
    'electron/*',
    'sqlite3',
    'utf-8-validate',
  ]);
});

test('a required external that does not resolve from dist/ fails the build before bundling', async (t) => {
  const root = makeRoot(t);
  const { build } = createMainBundle({
    root,
    requiredExternals: ['showtrak-no-such-package'],
  });
  await assert.rejects(build(), /External "showtrak-no-such-package" does not resolve from dist\//);
});

// --- build-renderer -----------------------------------------------------------

test('a renderer bundle is a minified browser IIFE with names kept and external maps', (t) => {
  const root = makeRoot(t);
  const Options = Renderer.rendererBundleOptions(
    {
      name: 'Desktop UI',
      entry: '/app/src/UI/js/app/main.ts',
      outfile: '/app/dist/UI/js/app/bundle.js',
    },
    { root }
  );
  assert.deepEqual(Options, {
    entryPoints: ['/app/src/UI/js/app/main.ts'],
    outfile: '/app/dist/UI/js/app/bundle.js',
    bundle: true,
    format: 'iife',
    target: 'es2022',
    platform: 'browser',
    minify: true,
    keepNames: true,
    sourcemap: true,
    legalComments: 'none',
    logLevel: 'info',
  });
});

test('ShowTrak Server’s service worker opts out of minify and keepNames', (t) => {
  const root = makeRoot(t);
  const Options = Renderer.rendererBundleOptions(
    {
      name: 'Web UI service worker',
      entry: 'sw.ts',
      outfile: 'sw.js',
      minify: false,
      keepNames: false,
    },
    { root }
  );
  assert.equal(Options.minify, false);
  assert.equal(Options.keepNames, false);
  assert.equal(Options.define, undefined);
});

test('ShowTrak Timers’ service worker is stamped with the app version', (t) => {
  const root = makeRoot(t, '2.1.0-beta.3');
  const Options = Renderer.rendererBundleOptions(
    { name: 'Web Dashboard service worker', entry: 'sw.ts', outfile: 'sw.js', stampVersion: true },
    { root }
  );
  assert.deepEqual(Options.define, { __APP_VERSION__: '"2.1.0-beta.3"' });
  assert.equal(Options.minify, true);
});

test('a build with no app version to stamp fails', (t) => {
  for (const Manifest of ['{}', '{"version": ""}', '{"version": 2}']) {
    const root = makeRoot(t);
    fs.writeFileSync(path.join(root, 'package.json'), Manifest);
    assert.throws(() => Renderer.appVersion(root), /no version/, Manifest);
  }
  assert.equal(Renderer.appVersion(makeRoot(t, '1.0.0')), '1.0.0');
});

test('a stamped bundle that came out without the version fails the build', (t) => {
  const root = makeRoot(t, '2.1.0');
  const outfile = path.join(root, 'sw.js');
  const bundle = { name: 'Worker', entry: 'sw.ts', outfile, stampVersion: true };
  fs.writeFileSync(outfile, 'const CACHE = "timers-2.1.0";');
  assert.doesNotThrow(() => Renderer.checkVersionStamp(bundle, { root }));
  fs.writeFileSync(outfile, 'const CACHE = "timers-" + __APP_VERSION__;');
  assert.throws(
    () => Renderer.checkVersionStamp(bundle, { root }),
    /does not carry the app version/
  );
  fs.writeFileSync(outfile, 'const CACHE = "timers";');
  assert.throws(() => Renderer.checkVersionStamp(bundle, { root }), /\(2\.1\.0\)/);
});
