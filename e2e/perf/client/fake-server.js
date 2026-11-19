'use strict';
// A fake ShowTrak Server for the client harness: a bare socket.io server that
// accepts the client's adopted connection, answers the acks a current server
// answers (GetServerCapabilities / GetScripts / GetVariables / GetLaunchConfig,
// mirroring ShowTrakServer src/Modules/Server/client-namespace.ts), and records
// every event: name, time and payload bytes.
//
// oldServer: true behaves like a server that predates the capability probe: the
// GetServerCapabilities ack is never invoked, so the client stays on full lists.
const http = require('http');
const { EventEmitter } = require('events');
const { requireFrom } = require('../lib/common');

function createFakeServer({ socketIoRepo, host = '127.0.0.1', port, oldServer = false }) {
  const { Server } = requireFrom(socketIoRepo, 'socket.io');
  const emitter = new EventEmitter();
  const state = {
    connections: [],
    events: [], // { t, name, bytes, connId }
    wire: { inBytes: 0, inPackets: 0, outBytes: 0, outPackets: 0, series: [] },
    samples: {}, // name -> { first, largest, largestBytes }
    acks: {}, // name -> count answered
    http: [],
  };
  let connSeq = 0;

  const httpServer = http.createServer((req, res) => {
    state.http.push({ t: Date.now(), method: req.method, url: req.url });
    res.statusCode = 404;
    res.end();
  });
  const io = new Server(httpServer, {
    // Same engine timings as the real server (Modules/Server/index.ts).
    pingTimeout: 2500,
    pingInterval: 5000,
    cors: { origin: '*' },
    maxHttpBufferSize: 1e8,
  });

  const answers = {
    GetServerCapabilities: oldServer ? undefined : () => ({ Deltas: true }),
    GetScripts: () => [],
    GetVariables: () => ({ Environment: {}, Exported: [] }),
    GetLaunchConfig: () => ({ ScriptID: null, DelaySeconds: null, ShowCountdown: false }),
  };

  io.on('connection', (socket) => {
    const conn = {
      id: ++connSeq,
      sid: socket.id,
      t: Date.now(),
      query: { ...socket.handshake.query },
      disconnectedAt: null,
      reason: null,
    };
    state.connections.push(conn);
    emitter.emit('connection', conn);

    socket.conn.on('packet', (p) => {
      if (p.type !== 'message') return;
      const b = typeof p.data === 'string' ? Buffer.byteLength(p.data) : p.data ? p.data.length : 0;
      state.wire.inBytes += b;
      state.wire.inPackets += 1;
    });
    socket.conn.on('packetCreate', (p) => {
      if (p.type !== 'message') return;
      const b = typeof p.data === 'string' ? Buffer.byteLength(p.data) : p.data ? p.data.length : 0;
      state.wire.outBytes += b;
      state.wire.outPackets += 1;
    });

    socket.onAny((name, ...args) => {
      const now = Date.now();
      const ack = args.length && typeof args[args.length - 1] === 'function' ? args.pop() : null;
      let json;
      try {
        json = JSON.stringify([name, ...args]);
      } catch {
        json = '';
      }
      // socket.io text packet = "2" + (ack id) + json; "42"-ish prefix ignored.
      const bytes = Buffer.byteLength(json) + 1;
      state.events.push({ t: now, name, bytes, connId: conn.id });
      const s =
        state.samples[name] ||
        (state.samples[name] = { first: args, largest: args, largestBytes: bytes });
      if (bytes > s.largestBytes) {
        s.largest = args;
        s.largestBytes = bytes;
      }
      emitter.emit('event', { t: now, name, bytes, conn });
      if (ack) {
        const fn = answers[name];
        if (fn) {
          state.acks[name] = (state.acks[name] || 0) + 1;
          ack(fn(args));
        } else {
          state.acks[`${name}(unanswered)`] = (state.acks[`${name}(unanswered)`] || 0) + 1;
        }
      }
    });

    socket.on('disconnect', (reason) => {
      conn.disconnectedAt = Date.now();
      conn.reason = reason;
      emitter.emit('disconnect', conn);
    });
  });

  return {
    emitter,
    state,
    io,
    listen() {
      return new Promise((resolve) =>
        httpServer.listen(port, host, () => resolve(httpServer.address().port))
      );
    },
    reset() {
      // Disconnect anything left from a previous run, and clear the recorders.
      for (const s of io.of('/').sockets.values()) s.disconnect(true);
      state.connections = [];
      state.events = [];
      state.wire = { inBytes: 0, inPackets: 0, outBytes: 0, outPackets: 0, series: [] };
      state.samples = {};
      state.acks = {};
      state.http = [];
    },
    wireSnapshot() {
      return { t: Date.now(), ...state.wire };
    },
    close() {
      return new Promise((resolve) => {
        io.close(() => resolve());
      });
    },
  };
}

// Per-event stats for [t0, t1].
function summarizeEvents(events, t0, t1) {
  const secs = (t1 - t0) / 1000;
  const by = {};
  let count = 0;
  let bytes = 0;
  for (const e of events) {
    if (e.t < t0 || e.t > t1) continue;
    const b = by[e.name] || (by[e.name] = { count: 0, bytes: 0 });
    b.count++;
    b.bytes += e.bytes;
    count++;
    bytes += e.bytes;
  }
  const perEvent = {};
  for (const [name, v] of Object.entries(by).sort((a, b) => b[1].bytes - a[1].bytes)) {
    perEvent[name] = {
      count: v.count,
      bytes: v.bytes,
      perSec: Number((v.count / secs).toFixed(4)),
      bytesPerSec: Number((v.bytes / secs).toFixed(2)),
      avgBytes: Math.round(v.bytes / v.count),
    };
  }
  return {
    seconds: secs,
    totalEvents: count,
    totalBytes: bytes,
    eventsPerSec: Number((count / secs).toFixed(4)),
    bytesPerSec: Number((bytes / secs).toFixed(2)),
    perEvent,
  };
}

module.exports = { createFakeServer, summarizeEvents };
