// src/electron/first-paint.ts gates showing the main window at startup on the
// renderer having its initial data, instead of a fixed 800 ms after load. A
// renderer that never initialises must still get its window shown. Ported from
// ShowTrak Server's main-first-paint and Timers' main-window tests. Each test
// loads the module afresh: the signal is once per process.
const test = require('node:test');
const assert = require('node:assert/strict');

const { fresh } = require('../helpers/module-mocks');

const FirstPaint = () => fresh('electron', 'first-paint');

test('waiters are released by the first delivery', async () => {
  const FP = FirstPaint();
  let Done = false;
  const Waiting = FP.whenInitialStateDelivered(60_000).then(() => (Done = true));
  await new Promise((r) => setImmediate(r));
  assert.equal(Done, false);
  FP.markInitialStateDelivered();
  await Waiting;
  assert.equal(Done, true);
  // Later waits resolve at once; repeat marks are harmless.
  FP.markInitialStateDelivered();
  await FP.whenInitialStateDelivered(60_000);
});

test('every waiter is released, not just the first', async () => {
  const FP = FirstPaint();
  const Released = [];
  const All = [1, 2, 3].map((N) =>
    FP.whenInitialStateDelivered(60_000).then(() => Released.push(N))
  );
  FP.markInitialStateDelivered();
  await Promise.all(All);
  assert.deepEqual(Released.sort(), [1, 2, 3]);
});

test('a renderer that never reports in is shown after the timeout anyway', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const FP = FirstPaint();
  let Done = false;
  const Waiting = FP.whenInitialStateDelivered(5000).then(() => (Done = true));
  t.mock.timers.tick(4999);
  await new Promise((r) => setImmediate(r));
  assert.equal(Done, false);
  t.mock.timers.tick(1);
  await Waiting;
  assert.equal(Done, true);
});

test('a delivery before the timeout cancels the timer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const FP = FirstPaint();
  const Waiting = FP.whenInitialStateDelivered(5000);
  FP.markInitialStateDelivered();
  await Waiting;
  // Nothing is left scheduled to fire later.
  assert.doesNotThrow(() => t.mock.timers.tick(10_000));
});
