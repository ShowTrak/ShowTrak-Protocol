// src/runtime/process-guards.ts: the last line of defence that keeps an app
// alive when a fault throws out of native or third-party code. Ported from
// ShowTrak Server's main-guards-and-hydration, Timers' main-process-guards and
// the Client's network-errors-and-guards tests (each app had its own copy).
//
// The REAL network-error classifier is used, so the transient versus fatal
// decision is genuinely exercised. InstallProcessGuards attaches to the REAL
// process object, so each test captures exactly what it added, drives those
// listeners directly, and detaches them at once: left attached they would
// swallow genuine failures in the rest of the file.
const test = require('node:test');
const assert = require('node:assert/strict');

const { fresh } = require('../helpers/module-mocks');
const { createLoggerStub } = require('../helpers/logger-stub');

/** A Node-style system error. */
function sysError(code, message = `send ${code} 224.0.0.251:5353`) {
  return Object.assign(new Error(message), { code });
}

function captureGuards() {
  const Log = createLoggerStub();
  const { InstallProcessGuards } = fresh('runtime', 'process-guards');
  const BeforeUncaught = process.listeners('uncaughtException').slice();
  const BeforeRejection = process.listeners('unhandledRejection').slice();
  InstallProcessGuards(Log.logger);
  const Uncaught = process
    .listeners('uncaughtException')
    .filter((L) => !BeforeUncaught.includes(L));
  const Rejection = process
    .listeners('unhandledRejection')
    .filter((L) => !BeforeRejection.includes(L));
  for (const L of Uncaught) process.removeListener('uncaughtException', L);
  for (const L of Rejection) process.removeListener('unhandledRejection', L);
  return { InstallProcessGuards, Uncaught, Rejection, Log };
}

test('one handler is attached for each fault channel, and it says so', () => {
  const G = captureGuards();
  assert.equal(G.Uncaught.length, 1);
  assert.equal(G.Rejection.length, 1);
  assert.deepEqual(G.Log.lines('log'), ['Process-level fault guards installed']);
});

test('installing again does nothing: faults are never logged twice', () => {
  const G = captureGuards();
  const Before = process.listeners('uncaughtException').length;
  G.InstallProcessGuards(G.Log.logger);
  G.InstallProcessGuards(createLoggerStub().logger);
  assert.equal(process.listeners('uncaughtException').length, Before);
  assert.equal(G.Log.lines('log').length, 1);
});

test('a NIC flap is warned about and survived, not logged as fatal', () => {
  const G = captureGuards();
  G.Uncaught[0](sysError('EADDRNOTAVAIL'));
  assert.deepEqual(G.Log.lines('error'), []);
  assert.equal(G.Log.lines('warn').length, 1);
  assert.match(G.Log.lines('warn')[0], /^Ignored transient network error: /);
  // The description carries the original message so the log stays diagnosable.
  assert.match(G.Log.lines('warn')[0], /224\.0\.0\.251:5353/);
});

test('a genuine bug is logged at error level and the process is not killed', () => {
  const G = captureGuards();
  const Bug = new TypeError('cannot read properties of undefined');
  G.Uncaught[0](Bug);
  assert.deepEqual(G.Log.lines('warn'), []);
  assert.equal(G.Log.entries.length, 2);
  const Logged = G.Log.entries[1];
  assert.equal(Logged.level, 'error');
  assert.equal(Logged.args[0], 'Uncaught exception (app kept alive):');
  assert.equal(Logged.args[1], Bug, 'the error itself is logged, stack and all');
});

test('unhandled rejections are classified the same way', () => {
  const G = captureGuards();
  G.Rejection[0](sysError('ECONNRESET', 'read ECONNRESET'));
  assert.equal(G.Log.lines('warn').length, 1);
  assert.match(G.Log.lines('warn')[0], /^Ignored transient network rejection: read ECONNRESET/);
  G.Rejection[0](new Error('a real bug'));
  assert.equal(G.Log.lines('error').length, 1);
  assert.match(G.Log.lines('error')[0], /^Unhandled promise rejection \(app kept alive\)/);
});

test('a non-Error rejection reason does not defeat the guard', () => {
  const G = captureGuards();
  for (const Reason of [null, undefined, 'a string', 42, {}, []]) {
    assert.doesNotThrow(() => G.Rejection[0](Reason));
  }
  assert.equal(G.Log.lines('error').length, 6);
});
