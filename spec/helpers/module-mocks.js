// Spec helper: intercept CommonJS `require` so the compiled modules in dist/
// that pull in Electron (or electron-updater) can be exercised in a plain Node
// process, the way the apps' own suites test their main-process modules.
//
// `node --test` runs each spec file in its own process, so a shim installed
// here never leaks into another file; each file still restores it when done.
//
// The spec files are named *.spec.js and live in spec/, outside node --test's
// default patterns (*.test.js, test-*.js, a test/ folder): ShowTrak Client
// runs `node --test` from its root, where this repo is checked out as shared/.
const Module = require('node:module');
const path = require('node:path');

const DIST = path.join(__dirname, '..', '..', 'dist');

/**
 * mocks: Array<{ match: (request: string) => boolean, value: unknown }>. The
 * first matching entry wins. Returns a restore() that undoes the patch.
 */
function installModuleMocks(mocks) {
  const original = Module._load;
  Module._load = function patchedLoad(request) {
    for (const mock of mocks) {
      if (mock.match(request)) return mock.value;
    }
    return original.apply(this, arguments);
  };
  return function restore() {
    Module._load = original;
  };
}

/** Matches a request for exactly this module name. */
function exactly(name) {
  return (request) => request === name;
}

/** The path of a compiled module: dist('electron', 'app-updater'). */
function dist(...segments) {
  return path.join(DIST, ...segments);
}

/**
 * Require a compiled module afresh, dropping it from the cache first, so its
 * module-level state (first-paint's signal, the process guards' installed flag)
 * starts clean.
 */
function fresh(...segments) {
  const resolved = require.resolve(dist(...segments));
  delete require.cache[resolved];
  return require(resolved);
}

/** Let pending promise callbacks and I/O callbacks run. */
async function flush(ticks = 5) {
  for (let i = 0; i < ticks; i++) await new Promise((resolve) => setImmediate(resolve));
}

/** Run `fn` with process.platform forced to `platform`, then restore it. */
function withPlatform(platform, fn) {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, 'platform', original);
  }
}

module.exports = { installModuleMocks, exactly, dist, fresh, flush, withPlatform };
