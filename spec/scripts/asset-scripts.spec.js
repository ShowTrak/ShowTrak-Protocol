// The asset build steps: scripts/lib/copy-dir.js, scripts/copy-assets.js,
// scripts/build-css.js and scripts/copy-bootstrap-icons.js, each run against a
// temp app root laid out as ShowTrak Server's and ShowTrak Timers' are.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { copyDir } = require('../../scripts/lib/copy-dir');
const { createAssetCopy } = require('../../scripts/copy-assets');
const { buildCss } = require('../../scripts/build-css');
const { copyBootstrapIcons } = require('../../scripts/copy-bootstrap-icons');

function makeRoot(t, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'st-protocol-assets-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(files)) {
    const full = path.join(root, ...file.split('/'));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  }
  return root;
}

/** Every file under `dir`, as '/'-separated paths relative to it, sorted. */
function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((Entry) => Entry.isFile())
    .map((Entry) =>
      path.relative(dir, path.join(Entry.parentPath, Entry.name)).split(path.sep).join('/')
    )
    .sort();
}

test('copyDir copies everything but TypeScript and what it is told to skip', (t) => {
  const root = makeRoot(t, {
    'src/a.html': 'a',
    'src/b.ts': 'b',
    'src/sub/c.css': 'c',
    'src/skipped/d.js': 'd',
    'src/e.js': 'e',
  });
  copyDir(path.join(root, 'src'), path.join(root, 'out'), {
    skipDirs: new Set([path.join(root, 'src', 'skipped')]),
    skipFiles: new Set([path.join(root, 'src', 'e.js')]),
  });
  assert.deepEqual(listFiles(path.join(root, 'out')), ['a.html', 'sub/c.css']);
  // A folder that does not exist copies nothing and does not throw.
  assert.doesNotThrow(() => copyDir(path.join(root, 'missing'), path.join(root, 'out2')));
  assert.equal(fs.existsSync(path.join(root, 'out2')), false);
});

const APPS = {
  Server: {
    directories: ['UI', 'WebUI', 'images', 'icons'],
    outputs: [
      'dist/UI/js/app/bundle.js',
      'dist/WebUI/main.js',
      'dist/UI/preloader.js',
      'dist/WebUI/sw.js',
    ],
  },
  Timers: {
    directories: ['UI', 'WebDashboard', 'images'],
    outputs: [
      'dist/UI/js/app/bundle.js',
      'dist/WebDashboard/dashboard.js',
      'dist/UI/preloader.js',
      'dist/WebDashboard/service-worker.js',
    ],
  },
};

for (const [App, { directories, outputs }] of Object.entries(APPS)) {
  test(`${App}: copy-assets never copies a file from src over a bundle`, (t) => {
    const root = makeRoot(t);
    const bundles = outputs.map((Out) => ({ outfile: path.join(root, ...Out.split('/')) }));
    const assets = createAssetCopy({ root, directories, bundles });
    assert.deepEqual(assets.directories, directories);
    assert.deepEqual(
      [...assets.skipFiles]
        .map((File) => path.relative(root, File).split(path.sep).join('/'))
        .sort(),
      outputs.map((Out) => Out.replace(/^dist\//, 'src/')).sort()
    );
    assert.deepEqual(
      [...assets.skipDirs].map((Dir) => path.relative(root, Dir).split(path.sep).join('/')),
      ['src/UI/js/app', 'src/UI/types']
    );
  });

  test(`${App}: copy-assets ships the asset folders, without sources or stale scripts`, (t) => {
    const [Web] = directories.filter((Dir) => Dir !== 'UI' && Dir !== 'images');
    const root = makeRoot(t, {
      'src/UI/index.html': 'html',
      'src/UI/css/main.css': 'css',
      'src/UI/preloader.ts': 'ts',
      'src/UI/preloader.js': 'a leftover script',
      'src/UI/js/app/main.ts': 'ts',
      'src/UI/types/global.d.ts': 'ts',
      'src/images/icon.png': 'png',
      [`src/${Web}/index.html`]: 'web',
      'src/Modules/not-an-asset.ts': 'ts',
    });
    const bundles = outputs.map((Out) => ({ outfile: path.join(root, ...Out.split('/')) }));
    const logged = [];
    t.mock.method(console, 'log', (Line) => logged.push(Line));
    const copied = createAssetCopy({ root, directories, bundles }).main();
    t.mock.restoreAll();
    // icons/ is the Server's, and absent here.
    assert.equal(copied, 3);
    assert.deepEqual(logged, ['[copy-assets] Copied 3 static asset directories into dist/']);
    assert.deepEqual(listFiles(path.join(root, 'dist')), [
      'UI/css/main.css',
      'UI/index.html',
      `${Web}/index.html`,
      'images/icon.png',
    ]);
  });
}

test('build-css concatenates the parts in file-name order, and only rewrites a change', (t) => {
  const root = makeRoot(t, {
    'src/UI/css/parts/10-app.css': '.app{}\n',
    'src/UI/css/parts/01-base.css': ':root{}\n',
    'src/UI/css/parts/02-layout.css': '.layout{}\n',
    'src/UI/css/parts/notes.txt': 'not a part',
  });
  const logged = [];
  t.mock.method(console, 'log', (Line) => logged.push(Line));
  const out = path.join(root, 'src', 'UI', 'css', 'main.css');
  assert.equal(buildCss({ root }), true);
  assert.equal(fs.readFileSync(out, 'utf8'), ':root{}\n.layout{}\n.app{}\n');
  const Written = fs.statSync(out).mtimeMs;
  assert.equal(buildCss({ root }), false);
  assert.equal(fs.statSync(out).mtimeMs, Written, 'an unchanged main.css is not rewritten');
  t.mock.restoreAll();
  assert.deepEqual(logged, [
    '[build-css] Concatenated 3 CSS part(s) -> src/UI/css/main.css',
    '[build-css] 3 CSS part(s) unchanged -> src/UI/css/main.css',
  ]);
});

test('copy-bootstrap-icons copies the font folder into the UI vendors', (t) => {
  const root = makeRoot(t, {
    'node_modules/bootstrap-icons/font/bootstrap-icons.css': 'css',
    'node_modules/bootstrap-icons/font/bootstrap-icons.min.css': 'min',
    'node_modules/bootstrap-icons/font/bootstrap-icons.json': '{}',
    'node_modules/bootstrap-icons/font/fonts/bootstrap-icons.woff2': 'woff2',
    'node_modules/bootstrap-icons/icons/alarm.svg': 'not copied',
  });
  copyBootstrapIcons({ root });
  assert.deepEqual(listFiles(path.join(root, 'src', 'UI', 'vendors', 'bootstrap-icons')), [
    'font/bootstrap-icons.css',
    'font/bootstrap-icons.json',
    'font/bootstrap-icons.min.css',
    'font/fonts/bootstrap-icons.woff2',
  ]);
});

test('copy-bootstrap-icons fails when the package is missing or incomplete', (t) => {
  assert.throws(() => copyBootstrapIcons({ root: makeRoot(t) }), { code: 'ENOENT' });
  const Incomplete = makeRoot(t, {
    'node_modules/bootstrap-icons/font/bootstrap-icons.css': 'css',
  });
  assert.throws(() => copyBootstrapIcons({ root: Incomplete }), { code: 'ENOENT' });
});
