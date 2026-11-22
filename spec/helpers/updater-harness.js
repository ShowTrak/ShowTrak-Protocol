// Spec helper for src/electron-main/app-updater.ts: stands in for Electron (`app`,
// the Squirrel autoUpdater, `net`), electron-updater and the macOS codesign
// probe, and creates an updater for a given app identity.
//
// The fakes are swappable per updater (Harness.Use) because the module under
// test reads them when it runs, not when it loads: `require('electron')` is
// evaluated once, its members on each use, and electron-updater is required on
// a packaged build's first check.
const childProcess = require('node:child_process');
const { EventEmitter } = require('node:events');
const path = require('node:path');

const { installModuleMocks, exactly, dist } = require('./module-mocks');
const { createLoggerStub } = require('./logger-stub');

/** A stand-in for electron-updater's autoUpdater, recording what it is told. */
function createFakeUpdater() {
  const updater = Object.assign(new EventEmitter(), {
    autoDownload: false,
    autoInstallOnAppQuit: undefined,
    allowPrerelease: undefined,
    updateConfigPath: undefined,
    checks: 0,
    checkImpl: async () => ({}),
    installs: [],
    feeds: [],
    checkForUpdates() {
      updater.checks++;
      return updater.checkImpl();
    },
    quitAndInstall(...args) {
      updater.installs.push(args);
    },
    setFeedURL(options) {
      updater.feeds.push(options);
    },
  });
  return updater;
}

function createUpdaterHarness() {
  const appState = { isPackaged: false };
  const current = { squirrel: new EventEmitter(), updater: createFakeUpdater() };
  const spawnCalls = [];

  const restore = installModuleMocks([
    {
      match: exactly('electron'),
      value: {
        app: {
          get isPackaged() {
            return appState.isPackaged;
          },
        },
        get autoUpdater() {
          return current.squirrel;
        },
        // No `net`: the module falls back to the global fetch, which the specs mock.
      },
    },
    {
      match: exactly('electron-updater'),
      value: {
        get autoUpdater() {
          return current.updater;
        },
      },
    },
    {
      // The macOS signing probe shells out to codesign; report a signed build.
      match: exactly('child_process'),
      value: {
        ...childProcess,
        spawnSync: (...args) => {
          spawnCalls.push(args);
          return {
            status: 0,
            stdout: '',
            stderr:
              'Authority=Developer ID Application: ShowTrak (TEAM123)\nTeamIdentifier=TEAM123',
          };
        },
      },
    },
  ]);

  const { CreateAppUpdater } = require(dist('electron-main', 'app-updater'));

  /**
   * An updater for `Identity` (CreateAppUpdater's options, less the logger),
   * registered against a recording RPC and window.
   */
  function Create(Identity) {
    const sent = [];
    const windowState = { destroyed: false, sendThrows: false, present: true };
    const fakeWindow = {
      isDestroyed: () => windowState.destroyed,
      webContents: {
        send: (channel, payload) => {
          if (windowState.sendThrows) throw new Error('render frame was disposed');
          sent.push({ channel, payload });
        },
      },
    };
    const logger = createLoggerStub();
    const Manager = CreateAppUpdater({ ...Identity, Logger: logger.logger });
    const handlers = {};
    const registered = [];
    Manager.Register(
      {
        handle: (channel, fn) => {
          registered.push(channel);
          handlers[channel] = fn;
        },
      },
      { getMainWindow: () => (windowState.present ? fakeWindow : null) }
    );
    const statuses = () => sent.map((s) => s.payload);
    return {
      Manager,
      handlers,
      registered,
      sent,
      windowState,
      logger,
      statuses,
      states: () => statuses().map((s) => s.state),
      /** Clear the in-flight status so the next check really starts. */
      settle(state = 'none') {
        Manager.sendAppUpdateStatus({ state });
        sent.length = 0;
      },
    };
  }

  return {
    appState,
    spawnCalls,
    Create,
    /** The Squirrel emitter and electron-updater fake the next calls see. */
    Use({ squirrel = current.squirrel, updater = current.updater } = {}) {
      current.squirrel = squirrel;
      current.updater = updater;
    },
    get squirrel() {
      return current.squirrel;
    },
    get updater() {
      return current.updater;
    },
    restore,
  };
}

/** The two apps' identities, as their updater modules pass them. */
const APP_IDENTITIES = {
  Server: {
    Owner: 'ShowTrak',
    Repo: 'ShowTrakServer',
    UserAgent: 'ShowTrakServer',
    TempConfigName: 'showtrak-app-update.yml',
  },
  Timers: {
    Owner: 'ShowTrak',
    Repo: 'ShowTrakTimers',
    UserAgent: 'ShowTrakTimers',
    TempConfigName: 'showtrak-timers-app-update.yml',
  },
};

/** Where the packaged-check specs expect the temporary app-update.yml. */
function tempConfigPath(Identity) {
  return path.join(require('node:os').tmpdir(), Identity.TempConfigName);
}

module.exports = { createUpdaterHarness, createFakeUpdater, APP_IDENTITIES, tempConfigPath };
