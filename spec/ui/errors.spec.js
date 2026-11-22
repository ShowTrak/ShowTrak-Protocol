const test = require('node:test');
const assert = require('node:assert/strict');

// Covers @showtrak/protocol/ui/errors: the renderer's error helpers in ShowTrak
// Server and ShowTrak Timers. Both apps' tests, merged.
const { ErrorMessage, HandleNonFatalError } = require('../../dist/ui/errors.js');

// --- ErrorMessage -----------------------------------------------------------

test('ErrorMessage prefers a non-empty message property', () => {
  assert.equal(ErrorMessage(new Error('boom')), 'boom');
  assert.equal(ErrorMessage({ message: 'plain object' }), 'plain object');
  assert.equal(ErrorMessage(new Error('boom'), 'fallback'), 'boom');
});

test('ErrorMessage falls back when message is absent, empty or not a string', () => {
  assert.equal(ErrorMessage({ message: '' }, 'fallback'), 'fallback');
  assert.equal(ErrorMessage({ message: 123 }, 'fallback'), 'fallback');
  assert.equal(ErrorMessage({}, 'fallback'), 'fallback');
  assert.equal(ErrorMessage(null, 'fallback'), 'fallback');
});

test('ErrorMessage stringifies the thrown value when there is no fallback', () => {
  assert.equal(ErrorMessage('a thrown string'), 'a thrown string');
  assert.equal(ErrorMessage(null), 'null');
  assert.equal(ErrorMessage(undefined), 'undefined');
  assert.equal(ErrorMessage(404), '404');
});

// --- HandleNonFatalError ----------------------------------------------------

/** Capture console.warn for the duration of `Fn`. */
function captureWarnings(Fn) {
  const Original = console.warn;
  const Calls = [];
  console.warn = (...Args) => Calls.push(Args);
  try {
    Fn();
    return Calls;
  } finally {
    console.warn = Original;
  }
}

test('HandleNonFatalError logs the context, with and without an error', () => {
  const Calls = captureWarnings(() => {
    HandleNonFatalError('Ctx:Thing', new Error('bad'));
    HandleNonFatalError('Ctx:Thing');
    HandleNonFatalError(null);
  });
  assert.equal(Calls.length, 3);
  assert.equal(Calls[0][0], '[NonFatal] Ctx:Thing');
  assert.match(Calls[0][1].message, /bad/);
  assert.deepEqual(Calls[1], ['[NonFatal] Ctx:Thing']);
  // A falsy context degrades to the bare prefix rather than "[NonFatal] null".
  assert.deepEqual(Calls[2], ['[NonFatal]']);
});

test('HandleNonFatalError never throws, even when the console does', () => {
  const Original = console.warn;
  console.warn = () => {
    throw new Error('console is gone');
  };
  try {
    // This is the last-resort reporter; if it can throw, error handling
    // elsewhere turns a non-fatal problem into a fatal one.
    assert.doesNotThrow(() => HandleNonFatalError('Ctx', new Error('x')));
  } finally {
    console.warn = Original;
  }
});
