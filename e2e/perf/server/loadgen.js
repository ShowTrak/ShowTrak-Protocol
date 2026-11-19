#!/usr/bin/env node
'use strict';
// Simulates N adopted ShowTrak Clients against a ShowTrak Server, reproducing
// the client's wire behaviour (ShowTrakClient src/Modules/MainClient +
// ProcessMonitor + Network/Audio/Power/Temperature/Storage monitors):
//
//   on connect   GetServerCapabilities / GetScripts / GetVariables / GetLaunchConfig
//                (acks), Heartbeat, +1s SystemInfo, +2s USBDeviceList,
//                +3s DisplayList, +4s NetworkInterfaces x2 (report + monitor
//                start), RunningApplications (full), AudioDevices, PowerStatus,
//                Temperatures, StorageVolumes
//   Heartbeat          every 1 s (volatile)
//   SystemInfo         every 20 s
//   USBDeviceList      every 60 s
//   DisplayList        every 60 s
//   NetworkInterfaces  every 60 s (NetworkMonitor full resync; no changes)
//   apps sample        every 3 s: on change ApplicationDelta (server supports
//                      deltas) or full RunningApplications; else keepalive
//                      (Items: [], NoChanges) every 20 s and a full list every 60 s
//   AudioDevices       every 20 s (keepalive)
//   PowerStatus / Temperatures / StorageVolumes  every 60 s (keepalive)
//
// Run as a child of server/run.js (IPC: {cmd:'mark'|'stats'|'stop'}) or alone:
//   node loadgen.js --url http://127.0.0.1:PORT --clients 300 [--ramp 15]
const C = require('../lib/common');
const { ClientPayloads } = require('./payloads');

const opts = C.parseArgs(process.argv.slice(2), {
  url: null,
  clients: 300,
  ramp: 15,
  uuidPrefix: 'perf-client-',
  version: '3.28.2',
  appChangeProb: 0.02,
  extraMonitors: true,
  clientRepo: C.DEFAULT_CLIENT_REPO,
  duration: 0, // standalone only: seconds to run then print stats
});
const { io } = C.requireFrom(opts.clientRepo, 'socket.io-client');

const sent = {}; // name -> { count, bytes }
const recv = {}; // name -> { count, bytes }
const counters = {
  connects: 0,
  disconnects: 0,
  connectErrors: 0,
  unadopt: 0,
  updateScripts: 0,
  capsDeltas: 0,
  capsNoReply: 0,
};
let windowStart = Date.now();
const ackLatency = []; // GetServerCapabilities etc. on connect

function bump(map, name, bytes) {
  const e = map[name] || (map[name] = { count: 0, bytes: 0 });
  e.count++;
  e.bytes += bytes;
}
function sizeOf(name, args) {
  try {
    return Buffer.byteLength(JSON.stringify([name, ...args])) + 1;
  } catch {
    return 0;
  }
}

class FakeClient {
  constructor(index) {
    this.index = index;
    this.uuid = `${opts.uuidPrefix}${String(index).padStart(3, '0')}`;
    this.p = new ClientPayloads(index, { version: opts.version });
    this.timers = [];
    this.supportsDeltas = false;
    this.connected = false;
  }
  emit(name, ...args) {
    if (!this.socket.connected) return;
    bump(sent, name, sizeOf(name, args));
    this.socket.emit(name, ...args);
  }
  emitVolatile(name, ...args) {
    if (!this.socket.connected) return;
    bump(sent, name, sizeOf(name, args));
    this.socket.volatile.emit(name, ...args);
  }
  ack(name, cb) {
    const t0 = Date.now();
    bump(sent, name, sizeOf(name, []));
    this.socket.emit(name, (...res) => {
      ackLatency.push(Date.now() - t0);
      cb(...res);
    });
  }
  every(ms, fn, firstDelay = ms) {
    const t = setTimeout(() => {
      fn();
      const iv = setInterval(fn, ms);
      this.timers.push(iv);
    }, firstDelay);
    this.timers.push(t);
  }
  after(ms, fn) {
    this.timers.push(setTimeout(fn, ms));
  }
  clear() {
    for (const t of this.timers) {
      clearTimeout(t);
      clearInterval(t);
    }
    this.timers = [];
  }
  start() {
    const s = (this.socket = io(opts.url, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      query: { UUID: this.uuid, Adopted: true },
    }));
    s.on('connect', () => this.onConnect());
    s.on('disconnect', () => {
      this.connected = false;
      counters.disconnects++;
      this.clear();
    });
    s.on('connect_error', () => counters.connectErrors++);
    s.onAny((name, ...args) => {
      const ack = args.length && typeof args[args.length - 1] === 'function' ? args.pop() : null;
      bump(recv, name, sizeOf(name, args));
      if (ack) ack({ Success: false, Error: 'not supported by load generator' });
    });
    s.on('Unadopt', () => counters.unadopt++);
    s.on('UpdateScripts', (RequestID) => {
      counters.updateScripts++;
      this.ack('GetScripts', () => this.emit('ScriptExecutionResponse', RequestID, null));
    });
    s.on('DeleteScripts', (RequestID) => this.emit('ScriptExecutionResponse', RequestID, null));
  }
  onConnect() {
    this.connected = true;
    counters.connects++;
    this.clear();
    this.supportsDeltas = false;
    let capsAnswered = false;
    this.ack('GetServerCapabilities', (caps) => {
      capsAnswered = true;
      this.supportsDeltas = !!(caps && caps.Deltas);
      if (this.supportsDeltas) counters.capsDeltas++;
    });
    this.after(10000, () => {
      if (!capsAnswered) counters.capsNoReply++;
    });
    this.ack('GetScripts', () => {});
    this.ack('GetVariables', () => {});
    this.ack('GetLaunchConfig', () => {});
    const p = this.p;
    const heartbeat = () => this.emitVolatile('Heartbeat', p.heartbeat());
    heartbeat();
    this.every(1000, heartbeat);
    this.every(20000, () => this.emit('SystemInfo', p.systemInfo()), 1000);
    this.every(60000, () => this.emit('USBDeviceList', p.usbDeviceList()), 2000);
    this.every(60000, () => this.emit('DisplayList', p.displayList()), 3000);
    this.after(4000, () => {
      // MainClient.ReportNetworkInterfaces, then NetworkMonitor.Start's first
      // (full) sample, then its 60 s resync.
      this.emit('NetworkInterfaces', p.networkInterfaces());
      this.every(60000, () => this.emit('NetworkInterfaces', p.networkInterfaces()), 0);
      this.startApps();
      if (opts.extraMonitors) {
        this.every(20000, () => this.emit('AudioDevices', p.audioDevices()), 0);
        this.every(60000, () => this.emit('PowerStatus', p.powerStatus()), 0);
        this.every(60000, () => this.emit('Temperatures', p.temperatures()), 0);
        this.every(60000, () => this.emit('StorageVolumes', p.storageVolumes()), 0);
      }
    });
  }
  // ProcessMonitor.emitSnapshot, ported.
  startApps() {
    const p = this.p;
    let lastEmitAt = Date.now();
    let lastFullEmitAt = lastEmitAt;
    this.emit('RunningApplications', p.runningApplicationsFull());
    this.every(3000, () => {
      const now = Date.now();
      const { changed, delta } = p.sampleApps(opts.appChangeProb);
      if (!changed) {
        if (now - lastFullEmitAt >= 60000) {
          lastEmitAt = lastFullEmitAt = now;
          this.emit('RunningApplications', p.runningApplicationsFull());
        } else if (now - lastEmitAt >= 20000) {
          lastEmitAt = now;
          this.emit('RunningApplications', p.runningApplicationsKeepalive());
        }
        return;
      }
      if (this.supportsDeltas) {
        lastEmitAt = now;
        this.emit('ApplicationDelta', p.applicationDelta(delta));
        return;
      }
      lastEmitAt = lastFullEmitAt = now;
      this.emit('RunningApplications', p.runningApplicationsFull());
    });
  }
}

const clients = [];
function startAll() {
  const n = opts.clients;
  const gap = n > 1 ? (opts.ramp * 1000) / n : 0;
  for (let i = 1; i <= n; i++) {
    setTimeout(
      () => {
        const c = new FakeClient(i);
        clients.push(c);
        c.start();
      },
      Math.floor((i - 1) * gap)
    );
  }
}

function stats() {
  const secs = (Date.now() - windowStart) / 1000;
  const fmt = (m) =>
    Object.fromEntries(
      Object.entries(m)
        .sort((a, b) => b[1].bytes - a[1].bytes)
        .map(([k, v]) => [
          k,
          {
            count: v.count,
            perSec: Number((v.count / secs).toFixed(3)),
            bytesPerSec: Number((v.bytes / secs).toFixed(1)),
          },
        ])
    );
  const tot = (m) =>
    Object.values(m).reduce((a, v) => ({ count: a.count + v.count, bytes: a.bytes + v.bytes }), {
      count: 0,
      bytes: 0,
    });
  const ts = tot(sent);
  const tr = tot(recv);
  return {
    seconds: secs,
    connected: clients.filter((c) => c.connected).length,
    started: clients.length,
    counters: { ...counters },
    sent: {
      eventsPerSec: Number((ts.count / secs).toFixed(2)),
      bytesPerSec: Number((ts.bytes / secs).toFixed(1)),
      perEvent: fmt(sent),
    },
    received: {
      eventsPerSec: Number((tr.count / secs).toFixed(3)),
      bytesPerSec: Number((tr.bytes / secs).toFixed(1)),
      perEvent: fmt(recv),
    },
    connectAckMs: {
      p50: C.percentile(ackLatency, 50),
      p95: C.percentile(ackLatency, 95),
      max: C.percentile(ackLatency, 100),
      n: ackLatency.length,
    },
  };
}
function mark() {
  windowStart = Date.now();
  for (const k of Object.keys(sent)) delete sent[k];
  for (const k of Object.keys(recv)) delete recv[k];
  for (const k of Object.keys(counters)) counters[k] = 0;
}

if (!opts.url) {
  console.error('usage: node loadgen.js --url http://127.0.0.1:PORT [--clients 300] [--ramp 15]');
  process.exit(2);
}
startAll();
if (process.send) {
  process.on('message', (msg) => {
    if (!msg || !msg.cmd) return;
    if (msg.cmd === 'mark') {
      mark();
      process.send({ id: msg.id, ok: true });
    } else if (msg.cmd === 'stats') {
      process.send({ id: msg.id, stats: stats() });
    } else if (msg.cmd === 'stop') {
      for (const c of clients) {
        c.clear();
        try {
          c.socket.disconnect();
        } catch {
          /* ignore */
        }
      }
      process.send({ id: msg.id, ok: true });
      setTimeout(() => process.exit(0), 200);
    }
  });
  process.on('disconnect', () => process.exit(0));
} else if (opts.duration > 0) {
  setTimeout(() => {
    console.log(JSON.stringify(stats(), null, 2));
    process.exit(0);
  }, opts.duration * 1000);
}
