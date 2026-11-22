// Concatenates an app's stylesheet parts (src/UI/css/parts/*.css, in file-name
// order) into src/UI/css/main.css, which copy-assets.js ships verbatim to
// dist/UI/css/main.css. ShowTrak Server and ShowTrak Timers build their CSS this
// way (the Timers' 0* parts are copies of the Server's).
//
// Concatenation is strictly order-preserving (Buffer.concat), so the cascade is
// exactly the parts' order. Edit the parts under src/UI/css/parts/, NOT
// main.css (it is regenerated on every build).
//
// The app's scripts/build-css.js:
//   require('../shared/scripts/build-css').buildCss({ root: path.resolve(__dirname, '..') });
const fs = require('node:fs');
const path = require('node:path');

/**
 * Write <root>/src/UI/css/main.css from the parts. Returns whether it changed.
 * @param {{ root: string }} options
 */
function buildCss({ root }) {
  const partsDir = path.join(root, 'src', 'UI', 'css', 'parts');
  const out = path.join(root, 'src', 'UI', 'css', 'main.css');
  const parts = fs
    .readdirSync(partsDir)
    .filter((name) => name.endsWith('.css'))
    .sort();
  const next = Buffer.concat(parts.map((name) => fs.readFileSync(path.join(partsDir, name))));

  // Skip the write when nothing changed so main.css's mtime does not churn on
  // every build: it lives under src/, which `npm start` (dev.js) watches, and a
  // needless rewrite would retrigger the watcher.
  const current = fs.existsSync(out) ? fs.readFileSync(out) : null;
  if (current && current.equals(next)) {
    console.log(`[build-css] ${parts.length} CSS part(s) unchanged -> src/UI/css/main.css`);
    return false;
  }
  fs.writeFileSync(out, next);
  console.log(`[build-css] Concatenated ${parts.length} CSS part(s) -> src/UI/css/main.css`);
  return true;
}

module.exports = { buildCss };
