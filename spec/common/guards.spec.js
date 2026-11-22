// src/common/guards.ts: the type guards values of unknown type pass through
// before use (JSON just parsed, socket and IPC payloads, files read back). Each
// must accept exactly what the checks it replaced accepted, in every app:
//   - IsArray: Array.isArray (all three apps).
//   - IsObject: `value && typeof value === 'object'`, arrays included
//     (ShowTrak Server, main process and renderer).
//   - IsRecord: the same without arrays (ShowTrak Client and ShowTrak Timers).
//   - ArrayOrEmpty: `Array.isArray(List) ? List : []`, returning the very array
//     (ShowTrak Server's renderer).
// Ported from the Server's guards and renderer-guards tests, Timers'
// common-guards test and the Client's utils-shared-helpers test.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const { IsArray, IsObject, IsRecord, ArrayOrEmpty } = require('../../dist/common/guards');

// Values as JSON.parse and the other untyped sources can produce them, and a
// few more besides.
const SAMPLES = [
  null,
  undefined,
  0,
  1,
  NaN,
  '',
  'text',
  true,
  false,
  [],
  [1, 'two', null],
  new Array(3),
  {},
  { Key: 'value' },
  { length: 0 },
  Object.create(null),
  Object.create(Array.prototype),
  new Date(0),
  new Map(),
  new Set([1]),
  new Uint8Array(2),
  new String('x'),
  new Error('e'),
  () => {},
  Symbol('s'),
  10n,
];

const describe = (Value) => Object.prototype.toString.call(Value);

test('IsArray answers exactly as Array.isArray, arrays from another realm included', () => {
  for (const Value of SAMPLES) {
    assert.equal(IsArray(Value), Array.isArray(Value), describe(Value));
  }
  // An array made in another context (a VM, a frame) fails instanceof Array.
  const Foreign = vm.runInNewContext('[1, 2, 3]');
  assert.equal(Foreign instanceof Array, false);
  assert.equal(IsArray(Foreign), true);
});

test('IsObject accepts every object, arrays included, and nothing else', () => {
  for (const Value of [{}, [], new Map(), new Date(0), Object.create(null), new String('x')]) {
    assert.equal(IsObject(Value), true, describe(Value));
  }
  for (const Value of [
    null,
    undefined,
    0,
    1,
    '',
    'text',
    true,
    false,
    Symbol('s'),
    10n,
    () => {},
  ]) {
    assert.equal(IsObject(Value), false, describe(Value));
  }
});

test('IsObject matches the `value && typeof value === "object"` checks it replaced', () => {
  for (const Value of SAMPLES) {
    assert.equal(IsObject(Value), Boolean(Value && typeof Value === 'object'), describe(Value));
  }
});

test('IsRecord accepts objects with named fields, and nothing else', () => {
  for (const Value of [{}, { Key: 'value' }, Object.create(null), new Date(0)]) {
    assert.equal(IsRecord(Value), true, describe(Value));
  }
  for (const Value of [null, undefined, 0, '', 'text', true, [], [1], () => {}, Symbol('s')]) {
    assert.equal(IsRecord(Value), false, describe(Value));
  }
  assert.equal(IsRecord(JSON.parse('{"Environment":{}}')), true);
});

test('IsRecord agrees with the checks it replaced on every kind of value', () => {
  const Replaced = (Value) => !!Value && typeof Value === 'object' && !Array.isArray(Value);
  for (const Value of SAMPLES) {
    assert.equal(IsRecord(Value), Replaced(Value), describe(Value));
  }
});

test('IsObject and IsRecord differ on arrays only', () => {
  for (const Value of SAMPLES) {
    if (Array.isArray(Value)) assert.notEqual(IsObject(Value), IsRecord(Value));
    else assert.equal(IsObject(Value), IsRecord(Value), describe(Value));
  }
});

test('the guards parse-check JSON as the readers use them', () => {
  // The shape of every reader: parse, then keep the value only if it fits.
  const Read = (Text) => {
    const Parsed = JSON.parse(Text);
    return IsRecord(Parsed) ? Parsed : {};
  };
  assert.deepEqual(Read('{"Key":"value"}'), { Key: 'value' });
  for (const Text of ['null', '[]', '[{"Key":"value"}]', '"text"', '7', 'true']) {
    assert.deepEqual(Read(Text), {}, Text);
  }
});

test('ArrayOrEmpty hands back the very array it was given', () => {
  const List = [1, 2, 3];
  assert.equal(ArrayOrEmpty(List), List);
  const Frozen = Object.freeze(['a']);
  assert.equal(ArrayOrEmpty(Frozen), Frozen);
});

test('ArrayOrEmpty turns anything that is not an array into an empty one', () => {
  for (const Value of [null, undefined, {}, 'abc', 0, { length: 1, 0: 'x' }]) {
    const Out = ArrayOrEmpty(Value);
    assert.ok(Array.isArray(Out), describe(Value));
    assert.equal(Out.length, 0, describe(Value));
  }
});
