const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The kit's contract with the apps that load it:
//   - every module is reachable as `@showtrak/protocol/ui/<name>` through the
//     package `exports` (how esbuild and Node find it from an app), and
//   - loading a module, or creating an app's toasts, dialog or update modal,
//     touches no DOM or page global: each app's renderer tests require these
//     files under plain Node, with no document, jQuery or window.

const ROOT = path.join(__dirname, '..', '..');
const MODULES = fs
  .readdirSync(path.join(ROOT, 'src', 'ui'))
  .filter((Name) => Name.endsWith('.ts') && !Name.endsWith('.d.ts'))
  .map((Name) => Name.slice(0, -'.ts'.length))
  .sort();

const PAGE_GLOBALS = ['document', 'window', '$', 'jQuery', 'bootstrap', 'Howl', 'CSS', 'DOMParser'];

test('there is no page in this process', () => {
  for (const Name of PAGE_GLOBALS) assert.equal(globalThis[Name], undefined, Name);
});

test('every kit module is exported as @showtrak/protocol/ui/<name>, with its declarations', () => {
  assert.ok(MODULES.length >= 10, MODULES.join(', '));
  for (const Name of MODULES) {
    const Resolved = require.resolve(`@showtrak/protocol/ui/${Name}`);
    assert.equal(Resolved, path.join(ROOT, 'dist', 'ui', `${Name}.js`));
    assert.ok(fs.existsSync(path.join(ROOT, 'dist', 'ui', `${Name}.d.ts`)), `${Name}.d.ts`);
  }
});

test('every kit module loads with no page globals', () => {
  for (const Name of MODULES) {
    assert.doesNotThrow(() => require(`@showtrak/protocol/ui/${Name}`), Name);
  }
});

test("creating each app's toasts, dialog and update modal touches nothing", () => {
  const { CreateToasts } = require('@showtrak/protocol/ui/toasts');
  const { CreateConfirmationDialog } = require('@showtrak/protocol/ui/confirm-dialog');
  const { CreateAppUpdates } = require('@showtrak/protocol/ui/app-updates');
  for (const IconStyle of ['outline', 'fill']) {
    const Toasts = CreateToasts({ IconStyle });
    assert.equal(typeof Toasts.Notify, 'function');
    assert.equal(typeof Toasts.showAlertStyleToast, 'function');
    assert.equal(typeof Toasts.iconForType, 'function');
  }
  assert.equal(typeof CreateConfirmationDialog({ OnActiveChange() {} }), 'function');
  const Updates = CreateAppUpdates({
    ProductName: 'ShowTrak Timers',
    IconStyle: 'fill',
    OpenButtonIds: ['SHOWTRAK_ABOUT_CHECK_UPDATES'],
    Api: () => {
      throw new Error('read too early');
    },
    CloseAllModals: async () => {},
  });
  assert.equal(typeof Updates.wireAppUpdates, 'function');
  assert.equal(typeof Updates.OpenAppUpdateModal, 'function');
  for (const Name of PAGE_GLOBALS) assert.equal(globalThis[Name], undefined, Name);
});
