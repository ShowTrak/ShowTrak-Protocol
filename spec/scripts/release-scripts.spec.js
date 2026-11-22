// The pure parts of the release and test tooling: scripts/publish-release.js's
// options and repository detection, scripts/run-isolated-tests.js's sandbox,
// and scripts/dev.js's change classification. The rest drives git, gh,
// node --test and Electron, and is exercised by using it.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const Publish = require('../../scripts/publish-release');
const Isolated = require('../../scripts/run-isolated-tests');
const Dev = require('../../scripts/dev');

// --- publish-release ----------------------------------------------------------

test('publish defaults to a signed, notarised, watched release that asks first', () => {
  assert.deepEqual(Publish.parseArgs([]), {
    mode: 'publish',
    variant: 'signed-notarized',
    yes: false,
    watch: true,
    allowDirty: false,
    republish: false,
  });
});

test('publish reads every option', () => {
  assert.deepEqual(
    Publish.parseArgs([
      '--draft',
      '-y',
      '--no-watch',
      '--allow-dirty',
      '--republish',
      '--variant=unsigned',
    ]),
    {
      mode: 'draft',
      variant: 'unsigned',
      yes: true,
      watch: false,
      allowDirty: true,
      republish: true,
    }
  );
  assert.equal(Publish.parseArgs(['--yes']).yes, true);
});

test('publish refuses an unknown option or variant', (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(process, 'exit', (Code) => {
    throw new Error(`exit ${Code}`);
  });
  assert.throws(() => Publish.parseArgs(['--publish-everything']), /exit 1/);
  assert.throws(() => Publish.parseArgs(['--variant=notarized']), /exit 1/);
});

test('publish finds owner/repo in https and ssh GitHub remotes', () => {
  for (const Url of [
    'https://github.com/ShowTrak/ShowTrakTimers.git',
    'https://github.com/ShowTrak/ShowTrakTimers',
    'git@github.com:ShowTrak/ShowTrakTimers.git',
    'ssh://git@github.com/ShowTrak/ShowTrakTimers.git',
  ]) {
    assert.equal(Publish.repoFromRemoteUrl(Url), 'ShowTrak/ShowTrakTimers', Url);
  }
  assert.equal(Publish.repoFromRemoteUrl('https://gitlab.com/ShowTrak/ShowTrakServer.git'), null);
  assert.equal(Publish.repoFromRemoteUrl(''), null);
});

// --- run-isolated-tests -------------------------------------------------------

test('the isolated suite sees an empty home on every platform', () => {
  const Sandbox = path.join('/tmp', 'showtrak-isolated-x');
  const Env = Isolated.isolatedEnv(Sandbox, { PATH: '/bin', HOME: '/Users/op' });
  assert.deepEqual(Env, {
    PATH: '/bin',
    HOME: Sandbox,
    USERPROFILE: Sandbox,
    APPDATA: path.join(Sandbox, 'AppData', 'Roaming'),
    XDG_DATA_HOME: path.join(Sandbox, '.local', 'share'),
  });
});

test('the isolated suite runs one file at a time, and passes extra arguments on', () => {
  assert.deepEqual(Isolated.testArgs(['test/db.test.js']), [
    '--test',
    '--test-concurrency=1',
    '--test-timeout=60000',
    '--test-force-exit',
    'test/db.test.js',
  ]);
});

// --- dev ----------------------------------------------------------------------

test('dev leaves what esbuild and build-css write to them', () => {
  for (const Rel of [
    'js/app/main.ts',
    'js/app/lib/x.ts',
    'css/main.css',
    'preloader.ts',
    'sw.ts',
  ]) {
    assert.equal(Dev.classifyAssetChange(Rel), 'ignore', Rel);
  }
});

test('dev rebuilds main.css for a stylesheet part, and copies anything else', () => {
  assert.equal(Dev.classifyAssetChange('css/parts/10-timers.css'), 'css');
  for (const Rel of ['index.html', 'img/logo.png', 'manifest.webmanifest', 'css/fonts.css', null]) {
    assert.equal(Dev.classifyAssetChange(Rel), 'copy', String(Rel));
  }
});

test('dev rebuilds shared/ for the compiled entry points’ TypeScript only', () => {
  assert.equal(Dev.isSharedSourceChange('runtime/logging.ts'), true);
  assert.equal(Dev.isSharedSourceChange(path.join('electron', 'app-updater.ts')), true);
  assert.equal(Dev.isSharedSourceChange('app.d.ts'), false);
  assert.equal(Dev.isSharedSourceChange('timers/api.d.ts'), false);
  assert.equal(Dev.isSharedSourceChange('README.md'), false);
  assert.equal(Dev.isSharedSourceChange(null), false);
});

test('dev turns on the app’s window reload with the variable the app reads', () => {
  assert.equal(Dev.DEV_RELOAD_ENV, 'SHOWTRAK_DEV_RELOAD');
});
