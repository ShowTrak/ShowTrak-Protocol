// src/common/arguments.ts: ParseArgumentString, which splits a script's
// configured argument string into argv. ShowTrak Client (running a script it
// was sent) and ShowTrak Server (Scripts:RunLocalFile) must split the same
// string the same way. Ported from the Server's local-scripts tests.
const test = require('node:test');
const assert = require('node:assert/strict');

const { ParseArgumentString } = require('../../dist/common/arguments');

test('plain arguments split on any run of whitespace', () => {
  assert.deepEqual(ParseArgumentString('a b   c'), ['a', 'b', 'c']);
  assert.deepEqual(ParseArgumentString('  --flag\tvalue\n-v  '), ['--flag', 'value', '-v']);
});

test('nothing to split gives no arguments', () => {
  for (const Value of ['', '   ', null, undefined, 0, false]) {
    assert.deepEqual(ParseArgumentString(Value), [], String(Value));
  }
  assert.deepEqual(ParseArgumentString(42), ['42'], 'a number is read as its text');
});

test('single and double quotes group, and are removed', () => {
  assert.deepEqual(ParseArgumentString('"a b" c'), ['a b', 'c']);
  assert.deepEqual(ParseArgumentString("'a b' c"), ['a b', 'c']);
  assert.deepEqual(ParseArgumentString('a"b"c'), ['abc']);
  assert.deepEqual(ParseArgumentString("--name 'Main Stage' -v"), ['--name', 'Main Stage', '-v']);
  // Each quote is literal inside the other.
  assert.deepEqual(ParseArgumentString(`"it's" 'say "hi"'`), ["it's", 'say "hi"']);
  // An empty quoted argument is dropped, as an empty token always was.
  assert.deepEqual(ParseArgumentString('a "" b'), ['a', 'b']);
});

test('a backslash takes the next character literally', () => {
  assert.deepEqual(ParseArgumentString('a\\ b'), ['a b']);
  assert.deepEqual(ParseArgumentString('\\"quoted\\"'), ['"quoted"']);
  assert.deepEqual(ParseArgumentString('C:\\\\Shows\\\\Main'), ['C:\\Shows\\Main']);
});

test('a trailing lone backslash is kept', () => {
  assert.deepEqual(ParseArgumentString('a\\'), ['a\\']);
});

test('an unterminated quote runs to the end', () => {
  assert.deepEqual(ParseArgumentString('a "b c'), ['a', 'b c']);
});

test('nothing is expanded', () => {
  assert.deepEqual(ParseArgumentString('$HOME *.txt `id` %PATH%'), [
    '$HOME',
    '*.txt',
    '`id`',
    '%PATH%',
  ]);
});
