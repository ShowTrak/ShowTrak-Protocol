// The compiled entry points resolve through package.json the way the apps
// load them: by package name (`@showtrak/protocol/<entry>`), through `exports`,
// to files the build wrote. A wrong path in `exports` or `typesVersions`
// would otherwise only show up in an app, as MODULE_NOT_FOUND at boot or as
// types silently resolving to nothing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { installModuleMocks, exactly } = require('./helpers/module-mocks');

const ROOT = path.join(__dirname, '..');
const Package = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const COMPILED = ['runtime', 'common', 'electron-main'];

/**
 * Whether a target names files the build wrote. A literal target is one file;
 * a subpath pattern (`./dist/ui/*.js`) must match at least one file in its
 * folder, as Node and TypeScript expand the `*`.
 */
function TargetExists(Target) {
  if (!Target.includes('*')) return fs.existsSync(path.join(ROOT, Target));
  const [Before, After] = Target.split('*');
  const Slash = Before.lastIndexOf('/');
  const Dir = path.join(ROOT, Before.slice(0, Slash));
  const Prefix = Before.slice(Slash + 1);
  return (
    fs.existsSync(Dir) &&
    fs
      .readdirSync(Dir)
      .some(
        (Name) =>
          Name.startsWith(Prefix) &&
          Name.endsWith(After) &&
          Name.length > Prefix.length + After.length
      )
  );
}

test('every export and typesVersions target exists', () => {
  for (const [Entry, Targets] of Object.entries(Package.exports)) {
    for (const Target of Object.values(Targets)) {
      assert.ok(TargetExists(Target), `${Entry} -> ${Target}`);
    }
  }
  for (const [Entry, [Target]] of Object.entries(Package.typesVersions['*'])) {
    assert.ok(TargetExists(Target), `typesVersions ${Entry} -> ${Target}`);
  }
});

test('a pattern target is checked against its folder, not as a literal file', () => {
  assert.equal(TargetExists('./dist/common/*.js'), true);
  assert.equal(TargetExists('./dist/common/*.nothing'), false);
  assert.equal(TargetExists('./dist/no-such-folder/*.js'), false);
});

test('every entry point is in both exports and typesVersions', () => {
  const FromExports = Object.keys(Package.exports)
    .filter((Key) => Key !== '.')
    .map((Key) => Key.slice(2))
    .sort();
  assert.deepEqual(Object.keys(Package.typesVersions['*']).sort(), FromExports);
});

test('each compiled entry point has JavaScript and declarations, both ways of asking', () => {
  for (const Entry of COMPILED) {
    assert.deepEqual(Package.exports[`./${Entry}`], {
      types: `./dist/${Entry}/index.d.ts`,
      default: `./dist/${Entry}/index.js`,
    });
    assert.deepEqual(Package.typesVersions['*'][Entry], [`dist/${Entry}/index.d.ts`]);
  }
});

test('the runtime entry point stays where ShowTrak Server’s packaging checks for it', () => {
  // forge.config.ts aborts a package without dist/runtime/index.js.
  assert.ok(fs.existsSync(path.join(ROOT, 'dist', 'runtime', 'index.js')));
});

test('the entry points load by package name', () => {
  const Common = require('@showtrak/protocol/common');
  assert.equal(typeof Common.IsRecord, 'function');
  assert.equal(typeof Common.CompareLooseVersions, 'function');
  assert.equal(typeof Common.ParseArgumentString, 'function');

  const Runtime = require('@showtrak/protocol/runtime');
  for (const Name of [
    'CreateAppLogging',
    'InstallProcessGuards',
    'WriteAndSyncFileSync',
    'ReplaceFileSync',
  ]) {
    assert.equal(typeof Runtime[Name], 'function', Name);
  }
  // What was there before is still there.
  for (const Name of ['IsTransientNetworkError', 'ChecksumFile', 'ResolveChannelRelease']) {
    assert.equal(typeof Runtime[Name], 'function', Name);
  }
});

test('the electron-main entry point loads without touching Electron', (t) => {
  // Its modules read Electron's members when called, never while loading, so
  // a stub with nothing on it is enough to load every one of them.
  const restore = installModuleMocks([{ match: exactly('electron'), value: {} }]);
  t.after(restore);
  const Electron = require('@showtrak/protocol/electron-main');
  for (const Name of [
    'CreateAppUpdater',
    'CreateShowFileAssociations',
    'SquirrelStubExecutable',
    'parseSquirrelReleases',
    'newestSquirrelPackages',
    'readSquirrelDownloadPercent',
    'applyWindowSecurityGuards',
    'applyWindowZoomShortcuts',
    'markInitialStateDelivered',
    'whenInitialStateDelivered',
    'StartDevReload',
    'CreateRendererBus',
  ]) {
    assert.equal(typeof Electron[Name], 'function', Name);
  }
});

test('each module of the common entry point loads on its own, by package name', () => {
  // A page served to browsers (ShowTrak Timers' Web Dashboard) imports just the
  // module it uses: esbuild cannot tree-shake this CommonJS, so the entry point
  // would bring every module into the bundle. A module requires nothing, so it
  // comes alone.
  const Dir = path.join(ROOT, 'dist', 'common');
  const Modules = fs
    .readdirSync(Dir)
    .filter((Name) => Name.endsWith('.js') && Name !== 'index.js')
    .map((Name) => Name.slice(0, -'.js'.length));
  assert.ok(Modules.includes('guards'), Modules.join(', '));
  for (const Name of Modules) {
    assert.equal(
      require.resolve(`@showtrak/protocol/common/${Name}`),
      path.join(Dir, `${Name}.js`)
    );
    assert.ok(fs.existsSync(path.join(Dir, `${Name}.d.ts`)), `${Name}.d.ts`);
    assert.doesNotMatch(fs.readFileSync(path.join(Dir, `${Name}.js`), 'utf8'), /require\(/, Name);
  }
  // The same functions the entry point exports, not copies.
  assert.equal(
    require('@showtrak/protocol/common/guards').IsArray,
    require('@showtrak/protocol/common').IsArray
  );
});

test('the common entry point loads nothing but itself', () => {
  // It is bundled into renderers, so it may not require anything: not Node's
  // built-ins, not another entry point.
  const Dir = path.join(ROOT, 'dist', 'common');
  for (const File of fs.readdirSync(Dir).filter((Name) => Name.endsWith('.js'))) {
    const Requires = [
      ...fs.readFileSync(path.join(Dir, File), 'utf8').matchAll(/require\("([^"]+)"\)/g),
    ]
      .map((M) => M[1])
      .filter((Request) => !/^\.\/[\w-]+$/.test(Request));
    assert.deepEqual(Requires, [], File);
  }
});
