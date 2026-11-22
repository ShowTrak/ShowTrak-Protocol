const test = require('node:test');
const assert = require('node:assert/strict');
const { installFakeDom } = require('./helpers/fake-dom');

// Covers @showtrak/protocol/ui/app-updates: the Software Update modal of
// ShowTrak Server and ShowTrak Timers, in each app's configuration (its name in
// the messages, its icon style, the buttons that open the modal, Timers'
// channel note). Neither app tested it before. The DOM is the small fake in
// helpers/, with the modal markup both apps share (by id).
const {
  APP_UPDATE_MODAL_ID,
  CreateAppUpdates,
  ExtractReleaseNotes,
  FormatUpdateVersion,
} = require('../../dist/ui/app-updates.js');

// The elements the kit drives, as both apps' index.html has them (Server also
// has its menu entry, Timers its channel note).
const MARKUP = `
  <a id="SHOWTRAK_MODEL_CORE_CHECKUPDATES">Check for Updates</a>
  <button id="SHOWTRAK_ABOUT_CHECK_UPDATES">Check for Updates</button>
  <div class="modal fade" id="SHOWTRAK_MODAL_APP_UPDATE">
    <div id="APP_UPDATE_ICON_WRAP"><svg><circle id="APP_UPDATE_RING_BAR"></circle></svg><i id="APP_UPDATE_ICON"></i></div>
    <h5 id="APP_UPDATE_STATUS"></h5><span id="APP_UPDATE_VERSION" class="d-none"></span>
    <p id="APP_UPDATE_SUBTEXT"></p>
    <p id="APP_UPDATE_CHANNEL_NOTE"></p>
    <div id="APP_UPDATE_NOTES_WRAPPER" class="d-none">
      <span id="APP_UPDATE_NOTES_VERSION"></span><div id="APP_UPDATE_CHANGELOG"></div>
    </div>
    <button id="APP_UPDATE_CHECK_BTN"></button>
    <button id="APP_UPDATE_INSTALL_BTN" class="d-none"></button>
    <button id="APP_UPDATE_LATER_BTN"></button>
  </div>
  <div id="APP_UPDATE_FLOAT" class="d-none">
    <span id="APP_UPDATE_FLOAT_VERSION"></span><span id="APP_UPDATE_FLOAT_DETAIL"></span>
    <div id="APP_UPDATE_FLOAT_TRACK"><div id="APP_UPDATE_FLOAT_BAR"></div></div>
  </div>`;

// A page with the markup, and a fake preload API recording what it is asked.
function setUp(t, App) {
  const Dom = installFakeDom();
  t.after(() => Dom.restore());
  Dom.add(MARKUP);
  const Log = [];
  let Listener = null;
  const Api = {
    CheckForAppUpdates: async () => Log.push('CheckForAppUpdates'),
    InstallAppUpdate: async () => Log.push('InstallAppUpdate'),
    OnAppUpdateStatus(Callback) {
      Log.push('OnAppUpdateStatus');
      Listener = Callback;
      return () => {};
    },
  };
  const Common = {
    Api: () => Api,
    CloseAllModals: async () => Log.push('CloseAllModals'),
  };
  const Options =
    App === 'Server'
      ? {
          ...Common,
          ProductName: 'ShowTrak Server',
          IconStyle: 'outline',
          OpenButtonIds: ['SHOWTRAK_MODEL_CORE_CHECKUPDATES', 'SHOWTRAK_ABOUT_CHECK_UPDATES'],
        }
      : {
          ...Common,
          ProductName: 'ShowTrak Timers',
          IconStyle: 'fill',
          OpenButtonIds: ['SHOWTRAK_ABOUT_CHECK_UPDATES'],
          OnOpen: () => {
            Log.push('OnOpen');
            Dom.$('#APP_UPDATE_CHANNEL_NOTE').text('Stable channel: full releases only.');
          },
        };
  const Updates = CreateAppUpdates(Options);
  Updates.wireAppUpdates();
  return {
    Dom,
    Log,
    Api,
    Updates,
    /** Push a status from main, as the preload's listener would. */
    push: (Status) => Listener(Status),
    text: (Id) => Dom.$('#' + Id).text(),
    hidden: (Id) => Dom.$('#' + Id).hasClass('d-none'),
    icon: () => Dom.$('#APP_UPDATE_ICON').attr('class'),
    modalOpen: () => Dom.$('#' + APP_UPDATE_MODAL_ID).hasClass('show'),
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// --- Pure helpers ------------------------------------------------------------

test('a version is shown with one leading v', () => {
  assert.equal(FormatUpdateVersion('3.40.0'), 'v3.40.0');
  assert.equal(FormatUpdateVersion('v3.40.0'), 'v3.40.0');
  assert.equal(FormatUpdateVersion('V2.0.0-beta.1'), 'V2.0.0-beta.1');
  for (const Empty of ['', null, undefined, 0]) assert.equal(FormatUpdateVersion(Empty), '');
});

test('release notes are found whichever shape electron-updater sends them in', () => {
  assert.equal(ExtractReleaseNotes({ releaseNotes: 'a' }), 'a');
  assert.equal(ExtractReleaseNotes({ notes: 'b' }), 'b');
  assert.equal(ExtractReleaseNotes({ body: 'c' }), 'c');
  // macOS: a list of releases, the first entry's notes taken.
  assert.equal(
    ExtractReleaseNotes({ releaseNotes: [null, { version: '1', note: 'x', notes: 'd' }] }),
    'd'
  );
  assert.equal(ExtractReleaseNotes({ releaseNotes: ['not an object'] }), '');
  assert.equal(ExtractReleaseNotes({ releaseNotes: [{ version: '1' }] }), '');
  assert.equal(ExtractReleaseNotes({}), '');
  assert.equal(ExtractReleaseNotes(null), '');
  assert.equal(ExtractReleaseNotes(undefined), '');
});

// --- Each app's configuration ---------------------------------------------------

const APPS = {
  Server: { Name: 'ShowTrak Server', Done: 'bi-check-circle', Failed: 'bi-exclamation-triangle' },
  Timers: {
    Name: 'ShowTrak Timers',
    Done: 'bi-check-circle-fill',
    Failed: 'bi-exclamation-triangle-fill',
  },
};

for (const [App, Expect] of Object.entries(APPS)) {
  test(`${App}: wiring subscribes to the updater's status once, and touches nothing else`, (t) => {
    const Page = setUp(t, App);
    assert.deepEqual(Page.Log, ['OnAppUpdateStatus']);
    assert.equal(Page.modalOpen(), false);
  });

  test(`${App}: the messages name the app, in its icon style`, (t) => {
    const Page = setUp(t, App);
    Page.push({ state: 'none' });
    assert.equal(Page.text('APP_UPDATE_STATUS'), "You're up to date");
    assert.equal(Page.text('APP_UPDATE_SUBTEXT'), `You have the latest version of ${Expect.Name}.`);
    assert.equal(Page.icon(), `bi ${Expect.Done}`);

    Page.push({ state: 'downloaded', info: { version: '9.0.0' } });
    assert.equal(Page.text('APP_UPDATE_STATUS'), 'Update ready to install');
    assert.equal(
      Page.text('APP_UPDATE_SUBTEXT'),
      `Install now to restart ${Expect.Name} on the new version.`
    );
    assert.equal(Page.icon(), `bi ${Expect.Done}`);
    assert.equal(Page.hidden('APP_UPDATE_INSTALL_BTN'), false);

    Page.push({ state: 'installing' });
    assert.equal(Page.text('APP_UPDATE_SUBTEXT'), `${Expect.Name} will restart shortly.`);
    assert.equal(Page.icon(), 'bi bi-gear-wide-connected SHOWTRAK_APP_UPDATE_SPIN');
    assert.equal(Page.hidden('APP_UPDATE_INSTALL_BTN'), true);

    Page.push({ state: 'installed' });
    assert.equal(Page.text('APP_UPDATE_STATUS'), 'Update installed');
    assert.equal(Page.icon(), `bi ${Expect.Done}`);

    Page.push({ state: 'error', error: 'Signature check failed' });
    assert.equal(Page.text('APP_UPDATE_STATUS'), 'Update failed');
    assert.equal(Page.text('APP_UPDATE_SUBTEXT'), 'Signature check failed');
    assert.equal(Page.icon(), `bi ${Expect.Failed}`);
  });

  test(`${App}: the About modal's button opens the modal and starts a check`, async (t) => {
    const Page = setUp(t, App);
    Page.Dom.$('#SHOWTRAK_ABOUT_CHECK_UPDATES').trigger('click');
    await settle();
    assert.equal(Page.modalOpen(), true);
    assert.ok(Page.Log.includes('CloseAllModals'));
    assert.ok(Page.Log.includes('CheckForAppUpdates'));
    assert.equal(Page.text('APP_UPDATE_STATUS'), 'Checking for updates...');
    assert.equal(Page.icon(), 'bi bi-arrow-repeat SHOWTRAK_APP_UPDATE_SPIN');
  });
}

test("Server: its menu entry opens the modal; Timers' menu wires its own", async (t) => {
  const Server = setUp(t, 'Server');
  Server.Dom.$('#SHOWTRAK_MODEL_CORE_CHECKUPDATES').trigger('click');
  await settle();
  assert.equal(Server.modalOpen(), true);
  assert.ok(Server.Log.includes('CheckForAppUpdates'));
  Server.Dom.restore();

  const Timers = setUp(t, 'Timers');
  Timers.Dom.$('#SHOWTRAK_MODEL_CORE_CHECKUPDATES').trigger('click');
  await settle();
  assert.equal(Timers.modalOpen(), false);
  assert.deepEqual(Timers.Log, ['OnAppUpdateStatus']);
});

test('Timers: OnOpen writes the channel note after the other modals close, before it shows', async (t) => {
  const Page = setUp(t, 'Timers');
  const Shown = [];
  Page.Dom.$('#' + APP_UPDATE_MODAL_ID).on('show.bs.modal', () => Shown.push([...Page.Log]));
  await Page.Updates.OpenAppUpdateModal();
  assert.deepEqual(Shown, [['OnAppUpdateStatus', 'CloseAllModals', 'OnOpen']]);
  assert.equal(Page.text('APP_UPDATE_CHANNEL_NOTE'), 'Stable channel: full releases only.');
  assert.deepEqual(Page.Log, [
    'OnAppUpdateStatus',
    'CloseAllModals',
    'OnOpen',
    'CheckForAppUpdates',
  ]);
});

test('the preload API is read when it is used, not when the modal is created', () => {
  let Reads = 0;
  CreateAppUpdates({
    ProductName: 'x',
    IconStyle: 'outline',
    OpenButtonIds: [],
    Api: () => {
      Reads++;
      throw new Error('no API yet');
    },
    CloseAllModals: () => {},
  });
  assert.equal(Reads, 0);
});

// --- A check and a download --------------------------------------------------------

test('an available update names its version and shows its Markdown notes', (t) => {
  const Page = setUp(t, 'Server');
  Page.push({
    state: 'available',
    info: { version: '3.40.0', releaseNotes: '## Fixes\n\n- Tags & "groups" fixed **now**' },
  });
  assert.equal(Page.text('APP_UPDATE_STATUS'), 'Update available');
  assert.equal(Page.text('APP_UPDATE_SUBTEXT'), 'Downloading the latest release...');
  assert.equal(Page.hidden('APP_UPDATE_VERSION'), false);
  assert.equal(Page.text('APP_UPDATE_VERSION'), 'v3.40.0');
  assert.equal(Page.hidden('APP_UPDATE_NOTES_WRAPPER'), false);
  assert.equal(Page.text('APP_UPDATE_NOTES_VERSION'), 'v3.40.0');
  const Notes = Page.Dom.$('#APP_UPDATE_CHANGELOG');
  assert.equal(Notes.find('h2').text(), 'Fixes');
  assert.equal(Notes.find('li').text(), 'Tags & "groups" fixed now');
  assert.equal(Notes.find('li strong').text(), 'now');
});

test('HTML release notes never reach the page raw', (t) => {
  // In the browser they go through the allowlist sanitizer (DOMParser). The fake
  // page has no DOMParser, so this is its fallback: the notes as escaped text.
  const Page = setUp(t, 'Timers');
  const Warn = console.warn;
  console.warn = () => {};
  try {
    Page.push({
      state: 'available',
      info: { version: '2.1.0', releaseNotes: '<p>Hi<img src=x></p>' },
    });
  } finally {
    console.warn = Warn;
  }
  const Notes = Page.Dom.$('#APP_UPDATE_CHANGELOG');
  assert.equal(Notes.find('img').length, 0);
  assert.equal(Notes.text(), '<p>Hi<img src=x></p>');
});

test('no notes hide the notes panel', (t) => {
  const Page = setUp(t, 'Server');
  Page.push({ state: 'available', info: { version: '3.40.0', releaseNotes: 'Notes' } });
  Page.push({ state: 'downloaded', info: { version: '3.40.0' } });
  assert.equal(Page.hidden('APP_UPDATE_NOTES_WRAPPER'), true);
  assert.equal(Page.Dom.$('#APP_UPDATE_CHANGELOG').text(), '');
});

test('a download shows its progress round the icon, and says when it is complete', (t) => {
  const Page = setUp(t, 'Timers');
  Page.push({ state: 'downloading', percent: 42.7, info: { tag: 'v2.1.0' } });
  assert.equal(Page.text('APP_UPDATE_STATUS'), 'Downloading update...');
  assert.equal(Page.text('APP_UPDATE_SUBTEXT'), '42% complete');
  assert.equal(Page.text('APP_UPDATE_VERSION'), 'v2.1.0');
  assert.equal(Page.Dom.$('#APP_UPDATE_ICON_WRAP').hasClass('has-progress'), true);
  const Offset = Number(Page.Dom.$('#APP_UPDATE_RING_BAR').css('stroke-dashoffset'));
  assert.ok(Math.abs(Offset - 2 * Math.PI * 22 * 0.58) < 1e-9, String(Offset));

  Page.push({ state: 'downloading', percent: 100 });
  assert.equal(Page.text('APP_UPDATE_SUBTEXT'), 'Download complete. Preparing update...');

  Page.push({ state: 'downloaded', info: { version: '2.1.0' } });
  assert.equal(Page.Dom.$('#APP_UPDATE_ICON_WRAP').hasClass('has-progress'), false);
});

test('a simulated install says so', (t) => {
  const Page = setUp(t, 'Server');
  Page.push({ state: 'installed', simulated: true });
  assert.equal(
    Page.text('APP_UPDATE_SUBTEXT'),
    'Simulated install complete. Restart the app to finish.'
  );
  Page.push({ state: 'installed' });
  assert.equal(Page.text('APP_UPDATE_SUBTEXT'), 'Restart the app to finish updating.');
});

test('an error without a message gets a generic one', (t) => {
  const Page = setUp(t, 'Server');
  Page.push({ state: 'error' });
  assert.equal(
    Page.text('APP_UPDATE_SUBTEXT'),
    'An unknown error occurred while checking for updates.'
  );
});

test('reopening during a download shows it rather than starting another check', async (t) => {
  const Page = setUp(t, 'Server');
  Page.push({ state: 'downloading', percent: 10, info: { version: '3.40.0' } });
  await Page.Updates.OpenAppUpdateModal();
  assert.equal(Page.modalOpen(), true);
  assert.equal(Page.text('APP_UPDATE_SUBTEXT'), '10% complete');
  assert.equal(Page.Log.includes('CheckForAppUpdates'), false);

  // The modal's own Check button does nothing while it runs, either.
  Page.Dom.$('#APP_UPDATE_CHECK_BTN').trigger('click');
  await settle();
  assert.equal(Page.Log.includes('CheckForAppUpdates'), false);
});

test("the modal's Check button starts a fresh check once nothing is running", async (t) => {
  const Page = setUp(t, 'Timers');
  Page.push({ state: 'available', info: { version: '2.1.0', releaseNotes: 'x' } });
  Page.push({ state: 'none' });
  Page.Dom.$('#APP_UPDATE_CHECK_BTN').trigger('click');
  await settle();
  assert.ok(Page.Log.includes('CheckForAppUpdates'));
  assert.equal(Page.text('APP_UPDATE_STATUS'), 'Checking for updates...');
  assert.equal(Page.hidden('APP_UPDATE_NOTES_WRAPPER'), true, 'the last notes are cleared');
  assert.equal(Page.hidden('APP_UPDATE_VERSION'), true);
});

test('opening without a check leaves the last result on screen', async (t) => {
  const Page = setUp(t, 'Server');
  Page.push({ state: 'none' });
  await Page.Updates.OpenAppUpdateModal(false);
  assert.equal(Page.modalOpen(), true);
  assert.equal(Page.text('APP_UPDATE_STATUS'), "You're up to date");
  assert.equal(Page.Log.includes('CheckForAppUpdates'), false);
});

// --- Buttons -----------------------------------------------------------------------

test('Install asks main to install, and a failure there is not fatal', async (t) => {
  const Page = setUp(t, 'Server');
  Page.Dom.$('#APP_UPDATE_INSTALL_BTN').trigger('click');
  await settle();
  assert.ok(Page.Log.includes('InstallAppUpdate'));

  const Warnings = [];
  const Warn = console.warn;
  console.warn = (...Args) => Warnings.push(Args);
  t.after(() => (console.warn = Warn));
  Page.Api.InstallAppUpdate = async () => {
    throw new Error('not now');
  };
  Page.Dom.$('#APP_UPDATE_INSTALL_BTN').trigger('click');
  await settle();
  assert.equal(Warnings[0][0], '[NonFatal] AppUpdate:Install');
});

test('Later closes the modal', async (t) => {
  const Page = setUp(t, 'Timers');
  await Page.Updates.OpenAppUpdateModal(false);
  Page.Dom.$('#APP_UPDATE_LATER_BTN').trigger('click');
  assert.equal(Page.modalOpen(), false);
  assert.deepEqual(Page.Dom.modalCalls.at(-1), [APP_UPDATE_MODAL_ID, 'hide']);
});

// --- The floating progress bar ------------------------------------------------------

test('the floating bar tracks a download while the modal is closed', async (t) => {
  const Page = setUp(t, 'Server');
  Page.push({ state: 'checking' });
  assert.equal(Page.hidden('APP_UPDATE_FLOAT'), true, 'a plain check stays silent');

  Page.push({ state: 'available', info: { version: '3.40.0' } });
  assert.equal(Page.hidden('APP_UPDATE_FLOAT'), false);
  assert.equal(Page.text('APP_UPDATE_FLOAT_VERSION'), 'v3.40.0');
  assert.equal(Page.text('APP_UPDATE_FLOAT_DETAIL'), 'Starting download...');
  assert.equal(Page.Dom.$('#APP_UPDATE_FLOAT_BAR').hasClass('is-indeterminate'), true);

  Page.push({ state: 'downloading', percent: 55.5 });
  assert.equal(Page.text('APP_UPDATE_FLOAT_VERSION'), 'v3.40.0', 'the version is remembered');
  assert.equal(Page.text('APP_UPDATE_FLOAT_DETAIL'), 'Downloading... 55%');
  assert.equal(Page.Dom.$('#APP_UPDATE_FLOAT_BAR').hasClass('is-indeterminate'), false);
  assert.equal(Page.Dom.$('#APP_UPDATE_FLOAT_BAR').css('width'), '55%');
  assert.equal(Page.Dom.$('#APP_UPDATE_FLOAT_TRACK').attr('aria-valuenow'), '55');

  Page.push({ state: 'downloaded', info: { version: '3.40.0' } });
  assert.equal(Page.hidden('APP_UPDATE_FLOAT'), true);
});

test('the floating bar hides while the modal is open and comes back when it closes', async (t) => {
  const Page = setUp(t, 'Timers');
  Page.push({ state: 'downloading', percent: 20, info: { version: '2.1.0' } });
  assert.equal(Page.hidden('APP_UPDATE_FLOAT'), false);

  Page.Dom.$('#APP_UPDATE_FLOAT').trigger('click');
  await settle();
  assert.equal(Page.modalOpen(), true);
  assert.equal(Page.hidden('APP_UPDATE_FLOAT'), true);
  assert.equal(Page.Log.includes('CheckForAppUpdates'), false, 'the bar opens without a check');

  Page.push({ state: 'downloading', percent: 30 });
  assert.equal(Page.hidden('APP_UPDATE_FLOAT'), true, 'not while the modal is up');

  Page.Dom.$('#' + APP_UPDATE_MODAL_ID).modal('hide');
  assert.equal(Page.hidden('APP_UPDATE_FLOAT'), false);
  assert.equal(Page.text('APP_UPDATE_FLOAT_DETAIL'), 'Downloading... 30%');
});

test('a new check forgets the version of the last download', (t) => {
  const Page = setUp(t, 'Server');
  Page.push({ state: 'available', info: { version: '3.40.0' } });
  Page.push({ state: 'checking' });
  Page.push({ state: 'available', info: {} });
  assert.equal(Page.text('APP_UPDATE_FLOAT_VERSION'), '');
});

test('wiring twice leaves one handler per button', async (t) => {
  const Page = setUp(t, 'Server');
  Page.Updates.wireAppUpdates();
  Page.Dom.$('#APP_UPDATE_INSTALL_BTN').trigger('click');
  await settle();
  assert.equal(Page.Log.filter((Entry) => Entry === 'InstallAppUpdate').length, 1);
});
