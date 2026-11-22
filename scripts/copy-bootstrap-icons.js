// Copies the Bootstrap Icons font and CSS from node_modules into
// src/UI/vendors/bootstrap-icons for local serving (ShowTrak Server and ShowTrak
// Timers run it on postinstall).
//
// bootstrap-icons is a devDependency (build-time only; the copied font/CSS
// ships in dist/), so this requires a full install; it fails under
// `npm ci --omit=dev`. The copied files are gitignored: package.json is the one
// place the version lives, so a Dependabot bump updates what ships. That makes
// this copy the ONLY source of the icons, so a failure fails the install rather
// than producing an app with blank icon glyphs.
//
// The app's scripts/copy-bootstrap-icons.js:
//   require('../shared/scripts/copy-bootstrap-icons').main({ root: path.resolve(__dirname, '..') });
//
// It runs on postinstall before `build:shared`'s output is relied on, so this is
// plain JavaScript that needs nothing built.
const fs = require('node:fs');
const path = require('node:path');

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

// Follows links (statSync), unlike lib/copy-dir.js, and copies every file.
function copyTree(srcDir, destDir) {
  ensureDir(destDir);
  for (const entry of fs.readdirSync(srcDir)) {
    const s = path.join(srcDir, entry);
    const d = path.join(destDir, entry);
    if (fs.statSync(s).isDirectory()) copyTree(s, d);
    else copyFile(s, d);
  }
}

/**
 * Copy <root>/node_modules/bootstrap-icons/font to
 * <root>/src/UI/vendors/bootstrap-icons/font. Throws when it cannot.
 * @param {{ root: string }} options
 */
function copyBootstrapIcons({ root }) {
  const nodeRoot = path.join(root, 'node_modules', 'bootstrap-icons');
  const vendorRoot = path.join(root, 'src', 'UI', 'vendors', 'bootstrap-icons');
  copyTree(path.join(nodeRoot, 'font'), path.join(vendorRoot, 'font'));
  // The unminified and minified CSS by name, so a package that stops shipping
  // either fails the install instead of serving blank glyphs.
  for (const name of ['bootstrap-icons.css', 'bootstrap-icons.min.css']) {
    copyFile(path.join(nodeRoot, 'font', name), path.join(vendorRoot, 'font', name));
  }
}

/** The postinstall step: copy, or fail the install. */
function main({ root }) {
  try {
    copyBootstrapIcons({ root });
    console.log('[postinstall] Copied Bootstrap Icons to UI/vendors/bootstrap-icons');
  } catch (e) {
    console.error('[postinstall] Failed to copy Bootstrap Icons:', e.message);
    process.exit(1);
  }
}

module.exports = { copyBootstrapIcons, main };
