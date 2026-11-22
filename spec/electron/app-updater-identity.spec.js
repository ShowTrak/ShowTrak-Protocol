// src/electron/app-updater.ts with each app's identity, as ShowTrak Server and
// ShowTrak Timers create it: every URL, header and file the updater derives
// from CreateAppUpdater's options names that app's repository and nothing else.
// The behaviour itself is covered by app-updater.spec.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { flush, withPlatform } = require('../helpers/module-mocks');
const {
  createUpdaterHarness,
  createFakeUpdater,
  APP_IDENTITIES,
  tempConfigPath,
} = require('../helpers/updater-harness');

const Harness = createUpdaterHarness();
const SavedAppImage = process.env.APPIMAGE;
process.env.APPIMAGE = path.join(os.tmpdir(), 'ShowTrak-test.AppImage');
test.after(() => {
  Harness.restore();
  for (const Identity of Object.values(APP_IDENTITIES)) {
    fs.rmSync(tempConfigPath(Identity), { force: true });
  }
  if (SavedAppImage === undefined) delete process.env.APPIMAGE;
  else process.env.APPIMAGE = SavedAppImage;
});

const RELEASES = [
  { tag_name: 'v9.0.0', draft: true },
  { tag_name: 'v4.0.0-beta.1', prerelease: true },
  { tag_name: 'v3.0.0' },
];

for (const [App, Identity] of Object.entries(APP_IDENTITIES)) {
  const { Owner, Repo, UserAgent } = Identity;

  test(`${App}: a packaged build is pointed at ${Repo}'s releases`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const updater = createFakeUpdater();
    Harness.Use({ updater });
    Harness.appState.isPackaged = true;
    t.after(() => (Harness.appState.isPackaged = false));
    const U = Harness.Create(Identity);

    // Stable: GitHub's latest release, through a temporary app-update.yml
    // named for this app.
    await U.handlers['AppUpdate:Check']();
    assert.equal(updater.updateConfigPath, tempConfigPath(Identity));
    assert.deepEqual(fs.readFileSync(tempConfigPath(Identity), 'utf8').split('\n'), [
      'provider: github',
      `owner: ${Owner}`,
      `repo: ${Repo}`,
    ]);
    updater.emit('update-not-available', {});

    // Beta: the newest release of this repository, looked up as this app.
    const Fetches = [];
    t.mock.method(globalThis, 'fetch', async (Url, Options) => {
      Fetches.push({ Url, Headers: Options.headers });
      return { ok: true, status: 200, text: async () => JSON.stringify(RELEASES) };
    });
    U.Manager.SetUpdateChannel('beta');
    U.settle();
    await U.handlers['AppUpdate:Check']();
    assert.deepEqual(Fetches, [
      {
        Url: `https://api.github.com/repos/${Owner}/${Repo}/releases?per_page=30`,
        Headers: { Accept: 'application/vnd.github+json', 'User-Agent': UserAgent },
      },
    ]);
    updater.emit('update-not-available', {});

    // Back to stable: the GitHub provider for this repository.
    U.Manager.SetUpdateChannel('stable');
    U.settle();
    await U.handlers['AppUpdate:Check']();
    updater.emit('update-not-available', {});
    assert.deepEqual(updater.feeds, [
      {
        provider: 'generic',
        url: `https://github.com/${Owner}/${Repo}/releases/download/v4.0.0-beta.1/`,
      },
      { provider: 'github', owner: Owner, repo: Repo },
    ]);
  });

  test(`${App}: a Squirrel install reads ${Repo}'s feed, manifest and release notes`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const squirrel = new EventEmitter();
    const SquirrelFeeds = [];
    squirrel.setFeedURL = (Feed) => SquirrelFeeds.push(Feed);
    squirrel.checkForUpdates = () => {};
    Harness.Use({ squirrel });
    const Fetches = [];
    t.mock.method(globalThis, 'fetch', async (Url, Options) => {
      Fetches.push({ Url, UserAgent: Options.headers['User-Agent'] });
      if (Url.endsWith('/RELEASES')) {
        return { ok: true, status: 200, text: async () => `SHA ${Repo}-4.0.0-full.nupkg 10\n` };
      }
      if (Url.includes('/releases?')) {
        return { ok: true, status: 200, text: async () => JSON.stringify(RELEASES) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ body: 'Notes' }) };
    });
    const Root = fs.mkdtempSync(path.join(os.tmpdir(), 'showtrak-squirrel-'));
    fs.writeFileSync(path.join(Root, 'Update.exe'), '');
    fs.mkdirSync(path.join(Root, 'app-3.0.0'));
    const ExecPath = process.execPath;
    Harness.appState.isPackaged = true;
    t.after(() => {
      process.execPath = ExecPath;
      Harness.appState.isPackaged = false;
      fs.rmSync(Root, { recursive: true, force: true });
    });
    const U = Harness.Create(Identity);

    const SquirrelCheck = async () => {
      process.execPath = path.join(Root, 'app-3.0.0', `${Repo}.exe`);
      const Checked = withPlatform('win32', () => U.handlers['AppUpdate:Check']());
      process.execPath = ExecPath;
      await Checked;
      squirrel.emit('update-available');
      await flush();
      squirrel.emit('update-not-available');
    };

    await SquirrelCheck();
    U.Manager.SetUpdateChannel('beta');
    U.settle();
    await SquirrelCheck();

    assert.deepEqual(SquirrelFeeds, [
      { url: `https://github.com/${Owner}/${Repo}/releases/latest/download/` },
      { url: `https://github.com/${Owner}/${Repo}/releases/download/v4.0.0-beta.1/` },
    ]);
    assert.deepEqual(
      Fetches.map((F) => F.Url),
      [
        `https://github.com/${Owner}/${Repo}/releases/latest/download/RELEASES`,
        `https://api.github.com/repos/${Owner}/${Repo}/releases/tags/v4.0.0`,
        `https://api.github.com/repos/${Owner}/${Repo}/releases?per_page=30`,
        `https://github.com/${Owner}/${Repo}/releases/download/v4.0.0-beta.1/RELEASES`,
        // The beta's notes come from its own tag: Squirrel rewrites the version.
        `https://api.github.com/repos/${Owner}/${Repo}/releases/tags/v4.0.0-beta.1`,
      ]
    );
    // The API calls identify the app; the release downloads carry no headers.
    assert.deepEqual(
      Fetches.filter((F) => F.Url.startsWith('https://api.github.com/')).map((F) => F.UserAgent),
      [UserAgent, UserAgent, UserAgent]
    );
  });
}
