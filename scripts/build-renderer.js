// Bundles an app's browser-side TypeScript with esbuild: the Electron
// renderer, its splash window, and any page or service worker the app serves
// (ShowTrak Server and ShowTrak Timers).
//
// The Node-side code is compiled by `tsc` into dist/. The renderer runs in a
// browser/Electron-renderer context and is authored as ES modules that are
// bundled into a single classic script per surface. Which surfaces there are
// (entry -> output) is the app's own list, its BUNDLES; this is how each one is
// built. Type-checking is done separately (the app's `typecheck:renderer`
// configs); esbuild only transpiles and bundles. Vendor libraries (jQuery,
// Bootstrap, Howler, socket.io) stay external <script> globals for offline use.
//
// The app's scripts/build-renderer.js:
//   const Renderer = require('../shared/scripts/build-renderer');
//   const ROOT = path.resolve(__dirname, '..');
//   const BUNDLES = [{ name, entry, outfile }, ...];
//   const bundleOptions = (bundle) => Renderer.rendererBundleOptions(bundle, { root: ROOT });
//   const appVersion = () => Renderer.appVersion(ROOT);
//   module.exports = { BUNDLES, bundleOptions, appVersion };
//   if (require.main === module) Renderer.main({ root: ROOT, bundles: BUNDLES });
const fs = require('node:fs');
const path = require('node:path');

/**
 * One surface: `entry` (a .ts file) bundled to `outfile`, both absolute.
 *   minify, keepNames: default true. A bundle that embeds a function into a
 *     page as source text (ShowTrak Server's service worker) turns keepNames
 *     off: it would add calls to a bundle-level __name() helper inside that
 *     function, which the page does not have.
 *   stampVersion: define __APP_VERSION__ as the app's version (ShowTrak
 *     Timers' service worker names its cache after it), and fail the build if
 *     the output does not carry it.
 * @typedef {{ name: string, entry: string, outfile: string, minify?: boolean, keepNames?: boolean, stampVersion?: boolean }} RendererBundle
 */

/**
 * The version stamped into a bundle as __APP_VERSION__: package.json's. There
 * must be one: a worker built without it would keep the same cache across updates.
 * @param {string} root the app's root folder
 */
function appVersion(root) {
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (typeof version !== 'string' || version.trim() === '') {
    throw new Error('[build-renderer] package.json has no version to stamp into the bundles');
  }
  return version;
}

/**
 * esbuild options for one bundle. Also used by the dev script, whose watch
 * mode must produce exactly what a full build does.
 * @param {RendererBundle} bundle
 * @param {{ root: string }} options
 */
function rendererBundleOptions(
  { entry, outfile, minify = true, keepNames = true, stampVersion = false },
  { root }
) {
  return {
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'iife',
    target: 'es2022',
    platform: 'browser',
    // Minified: parsed on every launch and served to every browser/phone that
    // opens the app's web surface. The external source maps keep stack traces
    // and DevTools mapped to the TypeScript, and keepNames keeps function/class
    // names readable in error logs.
    minify,
    keepNames,
    sourcemap: true,
    legalComments: 'none',
    logLevel: 'info',
    ...(stampVersion ? { define: { __APP_VERSION__: JSON.stringify(appVersion(root)) } } : {}),
  };
}

/**
 * A version-stamped bundle must come out with the version: the build fails if
 * the source stopped using __APP_VERSION__, or esbuild left it undefined.
 * @param {RendererBundle} bundle
 * @param {{ root: string }} options
 */
function checkVersionStamp(bundle, { root }) {
  const Version = appVersion(root);
  const Output = fs.readFileSync(bundle.outfile, 'utf8');
  if (Output.includes('__APP_VERSION__') || !Output.includes(Version)) {
    throw new Error(
      `[build-renderer] ${path.relative(root, bundle.outfile)} does not carry the app version (${Version})`
    );
  }
}

/**
 * Build every bundle, in order.
 * @param {{ root: string, bundles: RendererBundle[] }} options
 */
async function buildRendererBundles({ root, bundles }) {
  const esbuild = require('esbuild');
  for (const bundle of bundles) {
    await esbuild.build(rendererBundleOptions(bundle, { root }));
    if (bundle.stampVersion) checkVersionStamp(bundle, { root });
    console.log(
      `[build-renderer] Bundled ${bundle.name} -> ${path.relative(root, bundle.outfile)}`
    );
  }
  console.log(`[build-renderer] Completed (${bundles.length} bundles)`);
}

/** `node scripts/build-renderer.js`: build, or fail the build. */
function main(options) {
  return buildRendererBundles(options).catch((err) => {
    console.error('[build-renderer] Failed:', err);
    process.exit(1);
  });
}

module.exports = {
  appVersion,
  rendererBundleOptions,
  checkVersionStamp,
  buildRendererBundles,
  main,
};
