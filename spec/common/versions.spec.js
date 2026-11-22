// src/common/versions.ts: CompareLooseVersions, the lenient order used for the
// versions that are not release tags: Squirrel package names (which rewrite
// "2.0.0-beta.1" as "2.0.0-beta1") and show file versions. Ported from ShowTrak
// Timers' CompareVersions tests (its Utils, where the fix was made).
const test = require('node:test');
const assert = require('node:assert/strict');

const { CompareLooseVersions } = require('../../dist/common/versions');

const Sign = (Value) => Math.sign(Value);

test('dotted versions order numerically, part by part', () => {
  assert.equal(CompareLooseVersions('1.2.3', '1.2.3'), 0);
  assert.equal(Sign(CompareLooseVersions('1.2.3', '1.2.4')), -1);
  assert.equal(Sign(CompareLooseVersions('1.2.4', '1.2.3')), 1);
  assert.equal(Sign(CompareLooseVersions('1.10.0', '1.9.0')), 1, 'not a string comparison');
  assert.equal(Sign(CompareLooseVersions('2.0.0', '1.99.99')), 1);
  assert.equal(Sign(CompareLooseVersions('0.9', '1.0')), -1);
  assert.equal(Sign(CompareLooseVersions('3.36.1.2', '3.36.1')), 1, 'a fourth part counts');
});

test('missing parts are zero, and a leading v is ignored', () => {
  assert.equal(CompareLooseVersions('2.0', '2.0.0'), 0);
  assert.equal(CompareLooseVersions('2', '2.0.0'), 0);
  assert.equal(Sign(CompareLooseVersions('2.0.1', '2.0')), 1);
  assert.equal(CompareLooseVersions('v3.36.0', '3.36.0'), 0);
  assert.equal(CompareLooseVersions('V3.36.0', ' 3.36.0 '), 0);
});

test('a release outranks its own pre-releases', () => {
  for (const Pre of ['2.1.0-beta.2', '2.1.0-beta2', '2.1.0-rc.1', '2.1.0-alpha']) {
    assert.equal(Sign(CompareLooseVersions('2.1.0', Pre)), 1, Pre);
    assert.equal(Sign(CompareLooseVersions(Pre, '2.1.0')), -1, Pre);
  }
  // ...but not the next release's.
  assert.equal(Sign(CompareLooseVersions('2.0.0', '2.1.0-beta.1')), -1);
});

test('dotted pre-release numbers compare as numbers', () => {
  assert.equal(Sign(CompareLooseVersions('2.0.0-beta.2', '2.0.0-beta.1')), 1);
  assert.equal(Sign(CompareLooseVersions('2.0.0-beta.10', '2.0.0-beta.9')), 1);
  assert.equal(CompareLooseVersions('2.0.0-beta.1', '2.0.0-beta.1'), 0);
});

test('Squirrel pre-release names order the same as the tags they came from', () => {
  assert.equal(Sign(CompareLooseVersions('2.0.0-beta2', '2.0.0-beta1')), 1);
  assert.equal(Sign(CompareLooseVersions('2.0.0-beta10', '2.0.0-beta9')), 1);
  assert.equal(Sign(CompareLooseVersions('2.0.0-beta1', '2.0.0-beta2')), -1);
  assert.equal(CompareLooseVersions('2.0.0-beta1', '2.0.0-beta.1'), 0);
});

test('pre-release text orders as text, and below any number', () => {
  assert.equal(Sign(CompareLooseVersions('2.0.0-rc.1', '2.0.0-beta.9')), 1);
  assert.equal(Sign(CompareLooseVersions('2.0.0-beta', '2.0.0-beta.1')), -1);
  assert.equal(Sign(CompareLooseVersions('2.0.0-1', '2.0.0-beta')), -1);
});

test('never throws on text that is not a version', () => {
  assert.equal(CompareLooseVersions('', ''), 0);
  assert.equal(CompareLooseVersions('abc', '0.0.0'), 0);
  assert.equal(Sign(CompareLooseVersions('not-a-version', '0.0.1')), -1);
  assert.doesNotThrow(() => CompareLooseVersions(undefined, null));
});
