// scripts/trim-electron-locales.js, run from each app's forge.config.ts
// (packageAfterExtract): it deletes Chromium's UI translations (about 45 MB)
// from the freshly extracted Electron, keeping English and the en-US fallback.
// Ported from the identical tests in ShowTrak Server, Client and Timers (the
// Timers' superset).
//
// What matters: it removes only Chromium's locale packs, never anything else
// in the tree, and refuses to produce an Electron without en-US.pak.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  trimElectronLocales,
  KEEP_PAKS,
  KEEP_LPROJ,
} = require('../../scripts/trim-electron-locales');

function makeTree(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'st-protocol-trim-locales-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  for (const file of files) {
    const full = path.join(root, ...file.split('/'));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, 'x');
  }
  return root;
}

for (const App of ['ShowTrak Server', 'ShowTrak Client', 'ShowTrak Timers']) {
  const FRAMEWORK = `${App}.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Resources`;

  test(`${App}: keeps English lproj packs inside the macOS framework only`, (t) => {
    const root = makeTree(t, [
      `${FRAMEWORK}/en.lproj/locale.pak`,
      `${FRAMEWORK}/en_GB.lproj/locale.pak`,
      `${FRAMEWORK}/en_GB_FEMININE.lproj/locale.pak`,
      `${FRAMEWORK}/de.lproj/locale.pak`,
      `${FRAMEWORK}/de_FEMININE.lproj/locale.pak`,
      `${FRAMEWORK}/MainMenu.nib/keep`,
      `${FRAMEWORK}/other.lproj/not-a-locale-pack`,
      `${App}.app/Contents/Resources/de.lproj/.keep`,
    ]);
    assert.equal(trimElectronLocales(root), 2);
    assert.deepEqual(fs.readdirSync(path.join(root, ...FRAMEWORK.split('/'))).sort(), [
      'MainMenu.nib',
      'en.lproj',
      'en_GB.lproj',
      'en_GB_FEMININE.lproj',
      'other.lproj',
    ]);
    // The app's own (empty) Resources/*.lproj are not Chromium's and stay.
    assert.ok(fs.existsSync(path.join(root, `${App}.app`, 'Contents', 'Resources', 'de.lproj')));
  });
}

test('keeps en-US/en-GB packs on Windows/Linux layouts', (t) => {
  const root = makeTree(t, [
    'locales/en-US.pak',
    'locales/en-GB.pak',
    'locales/de.pak',
    'locales/zh-CN.pak',
    'locales/README.txt',
  ]);
  assert.equal(trimElectronLocales(root), 2);
  assert.deepEqual(fs.readdirSync(path.join(root, 'locales')).sort(), [
    'README.txt',
    'en-GB.pak',
    'en-US.pak',
  ]);
});

test('refuses a pack directory without the en-US fallback', (t) => {
  const root = makeTree(t, ['locales/de.pak']);
  assert.throws(() => trimElectronLocales(root), /no en-US\.pak/);
});

test('a tree with no locale packs is left alone', (t) => {
  const root = makeTree(t, ['resources/app.asar', 'ShowTrak Timers.app/Contents/Info.plist']);
  assert.equal(trimElectronLocales(root), 0);
  assert.ok(fs.existsSync(path.join(root, 'resources', 'app.asar')));
  assert.ok(fs.existsSync(path.join(root, 'ShowTrak Timers.app', 'Contents', 'Info.plist')));
});

test('running it twice removes nothing more', (t) => {
  const root = makeTree(t, ['locales/en-US.pak', 'locales/fr.pak']);
  assert.equal(trimElectronLocales(root), 1);
  assert.equal(trimElectronLocales(root), 0);
});

test('the keep lists are English only', () => {
  assert.deepEqual([...KEEP_PAKS].sort(), ['en-GB.pak', 'en-US.pak']);
  for (const Name of ['en.lproj', 'en_GB.lproj', 'en_GB_MASCULINE.lproj', 'en_NEUTER.lproj']) {
    assert.ok(KEEP_LPROJ.test(Name), Name);
  }
  for (const Name of ['en_US.lproj', 'en_AU.lproj', 'eng.lproj', 'de.lproj', 'en.lproj.bak']) {
    assert.equal(KEEP_LPROJ.test(Name), false, Name);
  }
});
