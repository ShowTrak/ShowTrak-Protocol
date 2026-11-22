// Copies an app's static runtime assets, which TypeScript does NOT compile,
// into dist/ so that __dirname-relative paths in the compiled main process
// resolve as they do in the src/ layout (ShowTrak Server and ShowTrak Timers).
//
// tsc compiles the Node-side code (src/Modules, src/main, src/main.ts,
// src/bridge_*.ts) into dist/. The renderer UI, the app's served web surface
// and the image/icon assets are excluded from compilation and copied verbatim;
// their scripts are bundled by build-renderer.js.
//
// The app's scripts/copy-assets.js:
//   const { BUNDLES } = require('./build-renderer');
//   const assets = require('../shared/scripts/copy-assets').createAssetCopy({
//     root: path.resolve(__dirname, '..'),
//     directories: ['UI', 'WebUI', 'images', 'icons'],
//     bundles: BUNDLES,
//   });
//   module.exports = { ASSET_DIRECTORIES: assets.directories, skipDirs: assets.skipDirs, skipFiles: assets.skipFiles };
//   if (require.main === module) assets.main();
const fs = require('node:fs');
const path = require('node:path');
const { copyDir } = require('./lib/copy-dir');

/**
 * @param {{ root: string, directories: string[], bundles: Array<{ outfile: string }> }} options
 *   directories: folders under src/ copied wholesale into dist/ (keep in step
 *   with the `exclude` globs of the app's tsconfig.json). bundles: the app's
 *   renderer BUNDLES, whose outputs nothing from src/ may overwrite.
 */
function createAssetCopy({ root, directories, bundles }) {
  const srcRoot = path.join(root, 'src');
  const distRoot = path.join(root, 'dist');

  // The renderer TypeScript sources are bundled by build-renderer.js (esbuild
  // owns dist/UI/js/app/). Skip those source dirs entirely so the copy never
  // ships them or creates empty mirror folders. Individual `.ts` files are also
  // skipped by copyDir, but skipping the dirs avoids empty output.
  const skipDirs = new Set([
    path.resolve(srcRoot, 'UI', 'js', 'app'),
    path.resolve(srcRoot, 'UI', 'types'),
  ]);

  // Nothing copied from src/ may land on an esbuild output. The splash window's
  // script and the service workers were plain JavaScript under src/ until they
  // became TypeScript; a leftover copy (an older checkout's file, never deleted)
  // would otherwise be copied over the freshly bundled script, since this step
  // runs after the bundling.
  const skipFiles = new Set(
    bundles.map((bundle) => path.resolve(srcRoot, path.relative(distRoot, bundle.outfile)))
  );

  function main() {
    let copied = 0;
    for (const dir of directories) {
      const source = path.join(srcRoot, dir);
      if (fs.existsSync(source)) {
        copyDir(source, path.join(distRoot, dir), { skipDirs, skipFiles });
        copied += 1;
      }
    }
    console.log(
      `[copy-assets] Copied ${copied} static asset director${copied === 1 ? 'y' : 'ies'} into dist/`
    );
    return copied;
  }

  return { directories: [...directories], skipDirs, skipFiles, main };
}

module.exports = { createAssetCopy };
