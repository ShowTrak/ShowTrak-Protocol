// src/electron/renderer-bus.ts: every main-process push fans out to every
// renderer surface (the desktop window, each Web UI socket) through one bus.
const test = require('node:test');
const assert = require('node:assert/strict');

const { CreateRendererBus } = require('../../dist/electron/renderer-bus');

test('a push reaches every registered sink, with its arguments in order', () => {
  const Bus = CreateRendererBus();
  const Desktop = [];
  const Web = [];
  Bus.RegisterRendererSink((Channel, ...Args) => Desktop.push([Channel, ...Args]));
  Bus.RegisterRendererSink((Channel, ...Args) => Web.push([Channel, ...Args]));
  Bus.PushToRenderers('Settings:Updated', [{ Key: 'A' }], ['Group']);
  Bus.PushToRenderers('ShowFile:OpenRequested');
  const Expected = [['Settings:Updated', [{ Key: 'A' }], ['Group']], ['ShowFile:OpenRequested']];
  assert.deepEqual(Desktop, Expected);
  assert.deepEqual(Web, Expected);
});

test('a throwing sink never stops delivery to the others', () => {
  const Bus = CreateRendererBus();
  const Received = [];
  Bus.RegisterRendererSink(() => {
    throw new Error('socket closed mid-push');
  });
  Bus.RegisterRendererSink((Channel) => Received.push(Channel));
  assert.doesNotThrow(() => Bus.PushToRenderers('Mode:Updated', 'SHOW'));
  assert.deepEqual(Received, ['Mode:Updated']);
});

test('an unsubscribed sink receives nothing more, and unsubscribing twice is harmless', () => {
  const Bus = CreateRendererBus();
  const Received = [];
  const Unsubscribe = Bus.RegisterRendererSink((Channel) => Received.push(Channel));
  Bus.PushToRenderers('One');
  Unsubscribe();
  Unsubscribe();
  Bus.PushToRenderers('Two');
  assert.deepEqual(Received, ['One']);
});

test('each bus has its own sinks', () => {
  const A = CreateRendererBus();
  const B = CreateRendererBus();
  const Received = [];
  A.RegisterRendererSink((Channel) => Received.push(Channel));
  B.PushToRenderers('Elsewhere');
  assert.deepEqual(Received, []);
});
