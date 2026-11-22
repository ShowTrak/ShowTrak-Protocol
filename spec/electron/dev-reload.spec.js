// src/electron/dev-reload.ts: reloading the window when the renderer is
// rebuilt, only ever in a development run started by the dev script. Ported
// from ShowTrak Timers' main-process-guards tests. Each test loads the module
// afresh: it starts once per process.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { installModuleMocks, exactly, fresh } = require('../helpers/module-mocks');
const { createLoggerStub } = require('../helpers/logger-stub');

const state = { isPackaged: false };
const restore = installModuleMocks([
  {
    match: exactly('electron'),
    value: {
      app: {
        get isPackaged() {
          return state.isPackaged;
        },
      },
    },
  },
]);
test.after(() => restore());

const DevReload = () => fresh('electron', 'dev-reload');

function withEnv(Value, Fn) {
  const Before = process.env.SHOWTRAK_DEV_RELOAD;
  if (Value === undefined) delete process.env.SHOWTRAK_DEV_RELOAD;
  else process.env.SHOWTRAK_DEV_RELOAD = Value;
  try {
    return Fn();
  } finally {
    if (Before === undefined) delete process.env.SHOWTRAK_DEV_RELOAD;
    else process.env.SHOWTRAK_DEV_RELOAD = Before;
  }
}

function options(Overrides = {}) {
  const Log = createLoggerStub();
  return {
    Log,
    Options: { Root: '/app/dist/UI', GetWindow: () => null, Logger: Log.logger, ...Overrides },
  };
}

test('the dev script turns it on with SHOWTRAK_DEV_RELOAD', () => {
  assert.equal(DevReload().DEV_RELOAD_ENV, 'SHOWTRAK_DEV_RELOAD');
});

test('dev reload stays off unless the dev script asked for it, and never runs packaged', (t) => {
  let Watched = 0;
  t.mock.method(fs, 'watch', () => {
    Watched++;
    return { close() {} };
  });
  withEnv(undefined, () => DevReload().StartDevReload(options().Options));
  withEnv('true', () => DevReload().StartDevReload(options().Options));
  assert.equal(Watched, 0, 'no watcher without SHOWTRAK_DEV_RELOAD=1');
  state.isPackaged = true;
  try {
    withEnv('1', () => DevReload().StartDevReload(options().Options));
  } finally {
    state.isPackaged = false;
  }
  assert.equal(Watched, 0, 'never in a packaged app');
});

test('dev reload reloads the window once a burst of renderer writes settles', (t) => {
  let OnChange = null;
  let WatchedRoot = null;
  t.mock.method(fs, 'watch', (Dir, Options, Handler) => {
    WatchedRoot = Dir;
    assert.deepEqual(Options, { recursive: true });
    OnChange = Handler;
    return { close() {} };
  });
  let Reloads = 0;
  const Window = {
    isDestroyed: () => false,
    webContents: { reloadIgnoringCache: () => Reloads++ },
  };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { Log, Options } = options({ GetWindow: () => Window });
  const Module = DevReload();
  withEnv('1', () => Module.StartDevReload(Options));
  assert.equal(WatchedRoot, '/app/dist/UI');
  assert.equal(typeof OnChange, 'function', 'the built UI folder is watched');
  OnChange('change', 'css/main.css');
  OnChange('change', 'js/app/bundle.js');
  t.mock.timers.tick(100);
  assert.equal(Reloads, 0, 'not while files are still being written');
  t.mock.timers.tick(300);
  assert.equal(Reloads, 1, 'one reload for the whole burst');
  assert.deepEqual(Log.lines('log'), [
    'Watching /app/dist/UI for renderer rebuilds',
    'Renderer rebuilt; reloading the window',
  ]);

  // Starting again in the same process does nothing.
  withEnv('1', () => Module.StartDevReload(Options));
  assert.equal(fs.watch.mock.callCount(), 1);
});

test('a missing or destroyed window is not reloaded', (t) => {
  let OnChange = null;
  t.mock.method(fs, 'watch', (_Dir, _Options, Handler) => {
    OnChange = Handler;
    return { close() {} };
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let Current = null;
  const { Options } = options({ GetWindow: () => Current });
  withEnv('1', () => DevReload().StartDevReload(Options));
  OnChange('change', 'x');
  t.mock.timers.tick(300);
  Current = {
    isDestroyed: () => true,
    webContents: { reloadIgnoringCache: () => assert.fail('reloaded a destroyed window') },
  };
  OnChange('change', 'x');
  t.mock.timers.tick(300);
});

test('dev reload survives a folder it cannot watch', (t) => {
  t.mock.method(fs, 'watch', () => {
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  });
  const { Log, Options } = options();
  assert.doesNotThrow(() => withEnv('1', () => DevReload().StartDevReload(Options)));
  assert.equal(Log.lines('warn').length, 1);
  assert.match(Log.lines('warn')[0], /reload the window manually/);
});
