const test = require('node:test');
const assert = require('node:assert/strict');

// Covers @showtrak/protocol/ui/settings-tabs: which Preferences tab ends up
// active as the tab set changes, and how numeric values are shown with their
// units. The DOM side (BuildSettingsNav in each app's settings.ts) is a thin
// adapter over this and is not covered here. Both apps' tests, merged.
const { FormatSettingValue, ResolveSettingsTab } = require('../../dist/ui/settings-tabs.js');

// Each app's tab keys: Server's are its settings groups plus the two lists that
// only show while they have entries; Timers' are its settings groups by Name.
const APPS = {
  Server: ['SYSTEM', 'ALERTS', '__REMOTE_ACCESS__', '__PAIRED_DEVICES__'],
  Timers: ['Machine', 'Alerts', 'Web', 'OSC'],
};

for (const [App, TABS] of Object.entries(APPS)) {
  const [First, Second, , Last] = TABS;

  test(`${App}: an available tab stays selected`, () => {
    assert.equal(ResolveSettingsTab(Second, TABS), Second);
    assert.equal(ResolveSettingsTab(Last, TABS), Last);
  });

  test(`${App}: a tab that has gone falls back to the first`, () => {
    assert.equal(ResolveSettingsTab(Last, [First, Second]), First);
    assert.equal(ResolveSettingsTab('nonsense', TABS), First);
  });

  test(`${App}: tab names match exactly, not case-insensitively`, () => {
    assert.equal(ResolveSettingsTab(Second.toLowerCase(), TABS), First);
  });

  test(`${App}: nothing selected yet picks the first tab`, () => {
    assert.equal(ResolveSettingsTab(null, TABS), First);
    assert.equal(ResolveSettingsTab(undefined, TABS), First);
    assert.equal(ResolveSettingsTab('', TABS), First);
  });

  test(`${App}: no tabs at all resolves to nothing`, () => {
    assert.equal(ResolveSettingsTab(First, []), '');
    assert.equal(ResolveSettingsTab(null, []), '');
  });
}

// ---- FormatSettingValue ---------------------------------------------------

test('a numeric setting shows its unit, spaced except for %', () => {
  assert.equal(FormatSettingValue(80, '%'), '80%');
  assert.equal(FormatSettingValue(500, 'ms'), '500 ms');
  assert.equal(FormatSettingValue(5, 's'), '5 s');
  assert.equal(FormatSettingValue(5, 'minutes'), '5 minutes');
});

test('a spelled-out unit reads singular for exactly 1', () => {
  assert.equal(FormatSettingValue(1, 'minutes'), '1 minute');
  assert.equal(FormatSettingValue('1', 'seconds'), '1 second');
  // Abbreviations are not plurals: "ms" and "s" stay as they are.
  assert.equal(FormatSettingValue(1, 'ms'), '1 ms');
  assert.equal(FormatSettingValue(1, 's'), '1 s');
});

test('no unit leaves the bare value', () => {
  assert.equal(FormatSettingValue(3, undefined), '3');
  assert.equal(FormatSettingValue(3, null), '3');
  assert.equal(FormatSettingValue(3, '  '), '3');
});

test('a missing value shows as empty rather than "undefined"', () => {
  assert.equal(FormatSettingValue(undefined, undefined), '');
  assert.equal(FormatSettingValue(null, '%'), '%');
});
