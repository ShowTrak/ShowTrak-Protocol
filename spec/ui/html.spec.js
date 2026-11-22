const test = require('node:test');
const assert = require('node:assert/strict');

// Covers @showtrak/protocol/ui/html: Safe, THE escaper for the renderers of
// ShowTrak Server and ShowTrak Timers. Every interpolated value in every
// template literal that becomes markup passes through it, so a regression here
// is an XSS hole across both apps' UIs (and Timers' Web Dashboard). Both apps'
// tests, merged.
const { Safe } = require('../../dist/ui/html.js');

test('Safe escapes all five significant HTML entities', () => {
  assert.equal(Safe(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
});

test('Safe escapes the ampersand first so entities are not double-encoded', () => {
  // If & were escaped last, '<' would become '&lt;' and then '&amp;lt;'.
  assert.equal(Safe('<'), '&lt;');
  assert.equal(Safe('&lt;'), '&amp;lt;');
});

test('Safe neutralises a script tag and an attribute breakout', () => {
  assert.equal(Safe('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  // Both quote styles are escaped, so the result is safe inside a double- OR
  // single-quoted attribute value. (Timers 1.x escaped only < and >.)
  assert.equal(Safe('" onerror="alert(1)'), '&quot; onerror=&quot;alert(1)');
  assert.equal(Safe("' onerror='alert(1)"), '&#39; onerror=&#39;alert(1)');
});

test('Safe escapes every occurrence, not just the first', () => {
  assert.equal(Safe('<<>>""'), '&lt;&lt;&gt;&gt;&quot;&quot;');
});

test('Safe collapses null and undefined to an empty string, never the literal word', () => {
  assert.equal(Safe(null), '');
  assert.equal(Safe(undefined), '');
});

test('Safe escapes arrays element-wise and comma-joins them', () => {
  assert.equal(Safe(['<a>', '<b>']), '&lt;a&gt;,&lt;b&gt;');
  assert.equal(Safe([]), '');
  // Nested arrays recurse through the same element-wise path.
  assert.equal(Safe([['<a>'], '<b>']), '&lt;a&gt;,&lt;b&gt;');
  // null/undefined members collapse individually rather than stringifying.
  assert.equal(Safe([null, undefined, 'x']), ',,x');
});

test('Safe coerces numbers and other values to their string form and escapes the result', () => {
  assert.equal(Safe(42), '42');
  assert.equal(Safe(0), '0');
  assert.equal(Safe(-1.5), '-1.5');
  assert.equal(Safe(false), 'false');
  assert.equal(Safe(NaN), 'NaN');
  // An object whose toString carries markup must not escape the escaper.
  assert.equal(Safe({ toString: () => '<img onerror=x>' }), '&lt;img onerror=x&gt;');
});

test('Safe leaves ordinary text untouched', () => {
  assert.equal(Safe('Walk In 5:00 / Act 1'), 'Walk In 5:00 / Act 1');
  assert.equal(Safe('Café ★'), 'Café ★');
});
