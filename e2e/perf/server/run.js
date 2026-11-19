#!/usr/bin/env node
'use strict';
// ShowTrak Server end-to-end perf harness (macOS).
//
//   node perf/server/run.js --app <server app dir> [--clients 100,300] [options]
//
// See perf/README.md.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');
const C = require('../lib/common');
const { TreeMonitor, diffCheckpoints } = require('../lib/proctree');
const { killTree, tail } = require('../lib/app');

const opts = C.parseArgs(process.argv.slice(2), {
  app: null,
  electron: null,
  serverRepo: C.DEFAULT_SERVER_REPO, // only used to locate the electron binary
  clientRepo: C.DEFAULT_CLIENT_REPO, // socket.io-client for the load generator + probes
  clients: '300', // comma list, e.g. 100,300
  runs: 3,
  duration: 180,
  warmup: 30, // seconds after every fake client is connected
  ramp: 15, // seconds over which the fake clients connect
  settle: 8, // seconds after the server listens before load starts
  port: 0, // 0 = pick a free port and patch APP_PORT in the copied dist
  sdk: 1, // /sdk sockets (API key, like Companion)
  webui: 1, // /ui sockets (logged in, like a browser)
  groups: 10,
  appChangeProb: 0.02,
  clientVersion: '3.28.2',
  extraMonitors: true,
  windowFlags: true, // keep the renderer un-throttled even if the window is covered
  pollMs: 250,
  pingMs: 1000,
  spawnHook: true,
  label: null,
  out: null,
  keep: false,
});
if (!opts.app) {
  console.error(
    'usage: node server/run.js --app <dir> [--clients 100,300] [--runs 3] [--duration 180] [--out file.json]'
  );
  process.exit(2);
}
const { io } = C.requireFrom(opts.clientRepo, 'socket.io-client');
const HOOK = path.join(C.HARNESS_ROOT, 'lib', 'spawn-hook.js');
const label = opts.label || path.basename(path.resolve(opts.app));
const workRoot = path.join(C.OUTPUT_ROOT, `server-${label}-${C.stamp()}`);
const outFile = opts.out || path.join(C.OUTPUT_ROOT, `results-server-${label}-${C.stamp()}.json`);
const SQLITE = '/usr/bin/sqlite3';

let currentLaunch = null;
let currentLoadgen = null;
async function cleanupAndExit(code) {
  try {
    if (currentLoadgen) currentLoadgen.kill('SIGKILL');
  } catch {
    /* ignore */
  }
  if (currentLaunch) {
    try {
      await killTree(currentLaunch);
    } catch {
      /* ignore */
    }
  }
  process.exit(code);
}
process.on('SIGINT', () => cleanupAndExit(130));
process.on('SIGTERM', () => cleanupAndExit(143));

const serverDataDir = (sandbox) =>
  path.join(sandbox, 'home', 'Library', 'Application Support', 'ShowTrakServer');
const dbPath = (sandbox) => path.join(serverDataDir(sandbox), 'Storage', 'DB.sqlite');
const sql = (db, statement) => C.execFileP(SQLITE, [db, statement]);

function patchPort(appDir, port) {
  const file = path.join(appDir, 'dist', 'Modules', 'Config', 'constants.js');
  const src = fs.readFileSync(file, 'utf8');
  const re = /exports\.APP_PORT\s*=\s*\d+\s*;/;
  if (!re.test(src)) throw new Error(`could not find APP_PORT in ${file}`);
  fs.writeFileSync(file, src.replace(re, `exports.APP_PORT = ${port};`));
  // Builds that run from the esbuild main bundle inline the constant there.
  const bundle = path.join(appDir, 'dist', 'main.bundle.js');
  if (fs.existsSync(bundle)) {
    const b = fs.readFileSync(bundle, 'utf8');
    const rb = /(exports\d*)\.APP_PORT\s*=\s*(?:\d+|3e3)\s*;/g;
    const hits = b.match(rb) || [];
    if (hits.length !== 1)
      throw new Error(`expected one APP_PORT assignment in ${bundle}, found ${hits.length}`);
    fs.writeFileSync(bundle, b.replace(rb, `$1.APP_PORT = ${port};`));
  }
}

async function launchServer(sandbox, logName = 'app.log') {
  const env = C.sandboxEnv({
    home: path.join(sandbox, 'home'),
    appData: path.join(sandbox, 'appdata'),
    extra: opts.spawnHook
      ? { PERF_SPAWN_TRACE: path.join(sandbox, 'spawns.jsonl'), NODE_OPTIONS: `--require ${HOOK}` }
      : {},
  });
  const extraArgs = opts.windowFlags
    ? [
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-background-timer-throttling',
      ]
    : [];
  // Extra Electron switches for one-off investigations (e.g. a DevTools port).
  if (process.env.PERF_EXTRA_ARGS)
    extraArgs.push(...process.env.PERF_EXTRA_ARGS.split(' ').filter(Boolean));
  return C.launchElectron({
    electron: opts.electronResolved,
    appDir: opts.appDirResolved,
    userDataDir: path.join(sandbox, 'userData'),
    env,
    extraArgs,
    logFile: path.join(sandbox, logName),
    rusageFile: path.join(sandbox, 'rusage.json'),
  });
}

async function prime(port) {
  const sandbox = path.join(C.OUTPUT_ROOT, path.basename(workRoot), 'template');
  for (const d of ['home', 'appdata', 'userData'])
    fs.mkdirSync(path.join(sandbox, d), { recursive: true });
  C.log('prime: first boot to create the working DB, settings and SDK key');
  const launch = await launchServer(sandbox, 'prime.log');
  currentLaunch = launch;
  let apiKey;
  try {
    await C.waitFor(() => C.portInUse(port), {
      timeoutMs: 120000,
      intervalMs: 250,
      what: `server listening on ${port}`,
    });
    apiKey = await C.waitFor(
      async () => {
        try {
          const v = (
            await sql(dbPath(sandbox), "SELECT value FROM settings WHERE key='SDK_API_KEY'")
          ).trim();
          return v || null;
        } catch {
          return null;
        }
      },
      { timeoutMs: 30000, intervalMs: 500, what: 'SDK_API_KEY in DB' }
    );
    await C.sleep(4000);
  } catch (e) {
    console.error(tail(path.join(sandbox, 'prime.log')));
    throw e;
  } finally {
    await killTree(launch);
    currentLaunch = null;
  }
  await sql(dbPath(sandbox), 'PRAGMA wal_checkpoint(TRUNCATE);');
  for (const f of ['rusage.json', 'rusage.json.pid', 'spawns.jsonl'])
    fs.rmSync(path.join(sandbox, f), { force: true });
  const cols = (
    await sql(dbPath(sandbox), "SELECT group_concat(name, ',') FROM pragma_table_info('Clients')")
  ).trim();
  C.log(`prime: done; SDK key ${apiKey.slice(0, 6)}…; Clients columns: ${cols}`);
  return { sandbox, apiKey };
}

// Adopt N clients the cheap way: insert the rows ClientManager.Create would
// (UUID, Slug, Timestamp; plus a group and descriptive fields a real client
// reports) straight into the sandboxed working DB, and point state.json at a
// show file saved "by this version" so the UI opens it with no upgrade or
// Save-As prompt.
async function seed(sandbox, n, version) {
  const lines = ['BEGIN;'];
  for (let g = 1; g <= opts.groups; g++) {
    const id = String(g).padStart(2, '0');
    lines.push(
      `INSERT INTO Groups (Title, Weight, Slug) VALUES ('Perf Group ${id}', ${g}, 'perf-group-${id}');`
    );
  }
  const now = Date.now();
  for (let i = 1; i <= n; i++) {
    const id = String(i).padStart(3, '0');
    const group =
      opts.groups > 0
        ? `(SELECT GroupID FROM Groups WHERE Slug='perf-group-${String(((i - 1) % opts.groups) + 1).padStart(2, '0')}')`
        : 'NULL';
    lines.push(
      `INSERT INTO Clients (UUID, Nickname, Hostname, OperatingSystem, Version, IP, GroupID, Weight, Slug, Timestamp) VALUES ('perf-client-${id}', NULL, 'SHOW-PC-${id}', 'Windows', '${opts.clientVersion}', NULL, ${group}, ${100 + i}, 'perf-client-${id}', ${now + i});`
    );
  }
  lines.push(
    `INSERT OR REPLACE INTO ShowFileInfo (Key, Value) VALUES ('CreatedWithVersion', '${version}'), ('SavedWithVersion', '${version}');`
  );
  lines.push('COMMIT;');
  lines.push('PRAGMA wal_checkpoint(TRUNCATE);');
  const sqlFile = path.join(sandbox, 'seed.sql');
  fs.writeFileSync(sqlFile, lines.join('\n'));
  await C.execFileP(SQLITE, [dbPath(sandbox), `.read ${sqlFile}`]);
  const count = Number((await sql(dbPath(sandbox), 'SELECT count(*) FROM Clients')).trim());
  if (count !== n) throw new Error(`seed: expected ${n} clients, DB has ${count}`);
  const showFile = path.join(sandbox, 'home', 'Perf.ShowTrak');
  fs.copyFileSync(dbPath(sandbox), showFile);
  fs.writeFileSync(
    path.join(serverDataDir(sandbox), 'state.json'),
    JSON.stringify({ CurrentFilePath: showFile }, null, 2)
  );
}

// --- observer sockets (SDK / Web UI / client-namespace probe) ---------------
function makeRecorder() {
  return { channels: {}, wireBytes: 0, wirePackets: 0 };
}
function attachRecorder(sock, rec) {
  sock.onAny((name, ...args) => {
    let b = 0;
    try {
      b = Buffer.byteLength(JSON.stringify([name, ...args])) + 1;
    } catch {
      /* ignore */
    }
    const c = rec.channels[name] || (rec.channels[name] = { count: 0, bytes: 0 });
    c.count++;
    c.bytes += b;
  });
  sock.io.on('open', () => {
    sock.io.engine.on('packet', (p) => {
      if (p.type !== 'message') return;
      rec.wireBytes +=
        typeof p.data === 'string'
          ? Buffer.byteLength(p.data)
          : p.data
            ? p.data.length || p.data.byteLength || 0
            : 0;
      rec.wirePackets++;
    });
  });
}
function resetRecorder(rec) {
  rec.channels = {};
  rec.wireBytes = 0;
  rec.wirePackets = 0;
}
function summarizeRecorder(rec, secs) {
  const perChannel = {};
  let count = 0;
  let bytes = 0;
  for (const [k, v] of Object.entries(rec.channels).sort((a, b) => b[1].bytes - a[1].bytes)) {
    perChannel[k] = {
      perSec: Number((v.count / secs).toFixed(3)),
      bytesPerSec: Number((v.bytes / secs).toFixed(1)),
      count: v.count,
    };
    count += v.count;
    bytes += v.bytes;
  }
  return {
    eventsPerSec: Number((count / secs).toFixed(3)),
    bytesPerSec: Number((bytes / secs).toFixed(1)),
    wireBytesPerSec: Number((rec.wireBytes / secs).toFixed(1)),
    perChannel,
  };
}

class Pinger {
  // Round trip of an acked event through the server's main-process event loop.
  constructor(sock, send, everyMs) {
    this.sock = sock;
    this.send = send;
    this.everyMs = everyMs;
    this.samples = [];
    this.outstanding = new Map();
    this.seq = 0;
    this.timeouts = 0;
  }
  start() {
    this.timer = setInterval(() => {
      if (!this.sock.connected) return;
      const id = ++this.seq;
      const t0 = process.hrtime.bigint();
      this.outstanding.set(id, t0);
      this.send(() => {
        if (!this.outstanding.has(id)) return;
        this.outstanding.delete(id);
        this.samples.push({ t: Date.now(), ms: Number(process.hrtime.bigint() - t0) / 1e6 });
      });
      for (const [k, v] of this.outstanding) {
        if (Number(process.hrtime.bigint() - v) / 1e6 > 10000) {
          this.outstanding.delete(k);
          this.timeouts++;
        }
      }
    }, this.everyMs);
  }
  stop() {
    clearInterval(this.timer);
  }
  stats(t0, t1) {
    const v = this.samples.filter((s) => s.t >= t0 && s.t <= t1).map((s) => s.ms);
    const r = (x) => (x === null ? null : Number(x.toFixed(2)));
    return {
      p50: r(C.percentile(v, 50)),
      p95: r(C.percentile(v, 95)),
      p99: r(C.percentile(v, 99)),
      max: r(C.percentile(v, 100)),
      mean: r(C.mean(v)),
      n: v.length,
      timeouts: this.timeouts,
    };
  }
}

function openObservers(url, apiKey) {
  const socks = [];
  const sdk = [];
  const web = [];
  for (let i = 0; i < opts.sdk; i++) {
    const s = io(`${url}/sdk`, { transports: ['websocket'], forceNew: true, auth: { apiKey } });
    const rec = makeRecorder();
    attachRecorder(s, rec);
    s.on('connect_error', (e) => C.log(`sdk socket ${i}: connect_error ${e && e.message}`));
    sdk.push({ s, rec });
    socks.push(s);
  }
  for (let i = 0; i < opts.webui; i++) {
    const s = io(`${url}/ui`, { transports: ['websocket'], forceNew: true });
    const rec = makeRecorder();
    attachRecorder(s, rec);
    const w = { s, rec, authed: false };
    s.on('connect', () => {
      s.emit('auth:login', {}, (res) => {
        w.authed = !!(res && res.ok);
        if (!w.authed) C.log(`webui socket ${i}: login failed ${JSON.stringify(res)}`);
      });
    });
    web.push(w);
    socks.push(s);
  }
  const probe = io(url, {
    transports: ['websocket'],
    forceNew: true,
    query: { UUID: 'perf-probe', Adopted: false },
  });
  socks.push(probe);
  const pingers = {
    sdkCommand: sdk.length
      ? new Pinger(
          sdk[0].s,
          (done) => sdk[0].s.emit('command', 'perf.ping', {}, () => done()),
          opts.pingMs
        )
      : null,
    clientNamespace: new Pinger(
      probe,
      (done) => probe.emit('GetServerCapabilities', () => done()),
      opts.pingMs
    ),
  };
  return { socks, sdk, web, probe, pingers };
}

function rssByKind(cp) {
  const out = { total: 0 };
  for (const p of cp.procs) {
    if (!p.helper) continue;
    out[p.kind] = Number(((out[p.kind] || 0) + p.rss / 1024).toFixed(1));
    out.total += p.rss / 1024;
  }
  out.total = Number(out.total.toFixed(1));
  return out;
}

function loadgenCall(child, cmd) {
  return new Promise((resolve, reject) => {
    const id = Math.random().toString(36).slice(2);
    const timer = setTimeout(() => reject(new Error(`loadgen ${cmd} timeout`)), 15000);
    const onMsg = (m) => {
      if (!m || m.id !== id) return;
      clearTimeout(timer);
      child.off('message', onMsg);
      resolve(m);
    };
    child.on('message', onMsg);
    child.send({ cmd, id });
  });
}

async function runOnce(n, i, ctx) {
  const sandbox = path.join(workRoot, `n${n}-run-${i}`);
  fs.cpSync(ctx.template, sandbox, { recursive: true });
  await seed(sandbox, n, ctx.version);
  const url = `http://127.0.0.1:${ctx.port}`;
  if (await C.portInUse(ctx.port)) throw new Error(`port ${ctx.port} is busy before launch`);
  C.log(`N=${n} run ${i}: launching server`);
  const launch = await launchServer(sandbox);
  currentLaunch = launch;
  const monitor = new TreeMonitor(launch.mainPid, { intervalMs: opts.pollMs });
  monitor.start();
  const metrics = {};
  const extra = {};
  let obs = null;
  let child = null;
  try {
    await C.waitFor(() => C.portInUse(ctx.port), {
      timeoutMs: 120000,
      intervalMs: 100,
      what: 'server listening',
    });
    metrics.listenMs = Date.now() - launch.t0;
    await C.sleep(opts.settle * 1000);
    obs = openObservers(url, ctx.apiKey);
    await C.waitFor(() => obs.socks.every((s) => s.connected) && obs.web.every((w) => w.authed), {
      timeoutMs: 20000,
      what: 'observer sockets',
    });
    Object.values(obs.pingers).forEach((p) => p && p.start());
    C.log(
      `N=${n} run ${i}: server up in ${metrics.listenMs} ms; starting ${n} fake clients over ${opts.ramp}s`
    );
    child = fork(
      path.join(__dirname, 'loadgen.js'),
      [
        '--url',
        url,
        '--clients',
        String(n),
        '--ramp',
        String(opts.ramp),
        '--version',
        opts.clientVersion,
        '--app-change-prob',
        String(opts.appChangeProb),
        '--client-repo',
        opts.clientRepo,
        ...(opts.extraMonitors ? [] : ['--no-extra-monitors']),
      ],
      { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] }
    );
    currentLoadgen = child;
    const tLoad = Date.now();
    await C.waitFor(async () => (await loadgenCall(child, 'stats')).stats.connected >= n, {
      timeoutMs: (opts.ramp + 60) * 1000,
      intervalMs: 1000,
      what: `${n} fake clients connected`,
    });
    metrics.allConnectedMs = Date.now() - tLoad;
    await C.sleep(opts.warmup * 1000);
    const A = await monitor.checkpoint('t0');
    await loadgenCall(child, 'mark');
    obs.sdk.forEach((x) => resetRecorder(x.rec));
    obs.web.forEach((x) => resetRecorder(x.rec));
    C.log(`N=${n} run ${i}: window ${opts.duration}s`);
    await C.sleep(opts.duration * 1000);
    const B = await monitor.checkpoint('t1');
    const lg = (await loadgenCall(child, 'stats')).stats;
    const win = diffCheckpoints(A, B, monitor);
    const secs = win.seconds;
    const cpu = { total: win.totalCpu };
    for (const [k, v] of Object.entries(win.byKind)) cpu[k] = v.cpu;
    metrics.cpuSeconds = cpu;
    metrics.cpuPctOneCore = Number(((win.totalCpu / secs) * 100).toFixed(2));
    metrics.rssMB = rssByKind(B);
    const series = monitor.rssSeries
      .filter((s) => s.t >= A.t && s.t <= B.t)
      .map((s) => s.total / 1024);
    metrics.rssMBAvgTotal = Number((C.mean(series) || 0).toFixed(1));
    metrics.rssMBGrowthInWindow = Number((rssByKind(B).total - rssByKind(A).total).toFixed(1));
    metrics.helperProcesses = B.procs.filter((p) => p.helper).length;
    metrics.lagMs = {
      sdkCommand: obs.pingers.sdkCommand ? obs.pingers.sdkCommand.stats(A.t, B.t) : null,
      clientNamespace: obs.pingers.clientNamespace.stats(A.t, B.t),
    };
    metrics.sdk = obs.sdk.length ? summarizeRecorder(obs.sdk[0].rec, secs) : null;
    metrics.webui = obs.web.length ? summarizeRecorder(obs.web[0].rec, secs) : null;
    metrics.load = {
      connected: lg.connected,
      sentEventsPerSec: lg.sent.eventsPerSec,
      sentBytesPerSec: lg.sent.bytesPerSec,
      receivedEventsPerSec: lg.received.eventsPerSec,
      receivedBytesPerSec: lg.received.bytesPerSec,
      disconnects: lg.counters.disconnects,
      unadopt: lg.counters.unadopt,
      updateScripts: lg.counters.updateScripts,
    };
    extra.loadgen = lg;
    const trace = C.readSpawnTrace(path.join(sandbox, 'spawns.jsonl'));
    const sp = trace.filter((r) => r.ev === 'spawn' && r.t >= A.t && r.t <= B.t);
    metrics.spawns = {
      hookCount: sp.length,
      polledUniquePids: monitor.childrenBetween(A.t, B.t).length,
    };
    extra.spawnsByCommand = sp.reduce((m, r) => ((m[r.cmd] = (m[r.cmd] || 0) + 1), m), {});
    extra.windowProcs = win.procs;
    extra.exitedHelpersInWindow = win.exitedHelpers;
  } finally {
    if (obs) {
      Object.values(obs.pingers).forEach((p) => p && p.stop());
      obs.socks.forEach((s) => s.disconnect());
    }
    if (child) {
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      currentLoadgen = null;
    }
    await monitor.stop();
    const k = await killTree(launch);
    currentLaunch = null;
    extra.lifetime = {
      mainOwnCpu: k.mainOwnCpu,
      wait4Cpu: k.rusage ? k.rusage.cpu : null,
      reapedChildrenCpu: k.reapedChildrenCpuLifetime,
    };
    // Validation drops / errors in the server log: proves the payloads are valid.
    const logText = fs.existsSync(path.join(sandbox, 'app.log'))
      ? fs.readFileSync(path.join(sandbox, 'app.log'), 'utf8')
      : '';
    let logsDirText = '';
    const logsDir = path.join(serverDataDir(sandbox), 'Logs');
    if (fs.existsSync(logsDir))
      for (const f of fs.readdirSync(logsDir))
        logsDirText += fs.readFileSync(path.join(logsDir, f), 'utf8');
    const all = logText + logsDirText;
    extra.serverLog = {
      droppedInvalid: (all.match(/Dropped invalid/g) || []).length,
      droppedVitals: (all.match(/Dropped vitals/g) || []).length,
      unknownClient: (all.match(/not found in the database|unknown client/gi) || []).length,
      handlerErrors: (all.match(/handler error/g) || []).length,
      sampleDropped: (all.match(/.*Dropped invalid.*/) || [null])[0],
    };
    metrics.serverLogDroppedInvalid = extra.serverLog.droppedInvalid;
    if (!opts.keep) fs.rmSync(path.join(sandbox, 'userData'), { recursive: true, force: true });
  }
  return { metrics, extra };
}

function textSummary(res) {
  const L = [];
  L.push(`ShowTrak Server perf — ${res.label} (v${res.version}), port ${res.port}`);
  for (const [n, sc] of Object.entries(res.scenarios)) {
    const m = sc.median;
    L.push('');
    L.push(
      `N=${n} fake clients — ${sc.runs.length} runs, window ${res.options.duration}s after ${res.options.warmup}s warmup; medians`
    );
    const cpu = m.cpuSeconds || {};
    L.push(
      `CPU-seconds: total ${cpu.total} (${m.cpuPctOneCore}% of one core) — ` +
        Object.entries(cpu)
          .filter(([k]) => k !== 'total')
          .map(([k, v]) => `${k} ${v}`)
          .join(', ')
    );
    L.push(
      `RSS end: total ${m.rssMB.total} MB — ` +
        Object.entries(m.rssMB)
          .filter(([k]) => k !== 'total')
          .map(([k, v]) => `${k} ${v}`)
          .join(', ') +
        ` (avg ${m.rssMBAvgTotal} MB, growth in window ${m.rssMBGrowthInWindow} MB)`
    );
    const l = m.lagMs || {};
    if (l.sdkCommand)
      L.push(
        `/sdk command RTT ms: p50 ${l.sdkCommand.p50} p95 ${l.sdkCommand.p95} p99 ${l.sdkCommand.p99} max ${l.sdkCommand.max}`
      );
    if (l.clientNamespace)
      L.push(
        `client-ns ack RTT ms: p50 ${l.clientNamespace.p50} p95 ${l.clientNamespace.p95} p99 ${l.clientNamespace.p99} max ${l.clientNamespace.max}`
      );
    if (m.sdk)
      L.push(
        `/sdk subscriber: ${m.sdk.eventsPerSec} events/s, ${m.sdk.bytesPerSec} B/s (${m.sdk.wireBytesPerSec} B/s wire) — top: ${Object.entries(
          m.sdk.perChannel || {}
        )
          .slice(0, 4)
          .map(([k, v]) => `${k} ${v.bytesPerSec} B/s`)
          .join(', ')}`
      );
    if (m.webui)
      L.push(
        `/ui subscriber: ${m.webui.eventsPerSec} events/s, ${m.webui.bytesPerSec} B/s (${m.webui.wireBytesPerSec} B/s wire) — top: ${Object.entries(
          m.webui.perChannel || {}
        )
          .slice(0, 4)
          .map(([k, v]) => `${k} ${v.bytesPerSec} B/s`)
          .join(', ')}`
      );
    const ld = m.load || {};
    L.push(
      `load: ${ld.connected} connected, ${ld.sentEventsPerSec} events/s, ${ld.sentBytesPerSec} B/s sent; server->clients ${ld.receivedEventsPerSec} ev/s; disconnects ${ld.disconnects}, unadopt ${ld.unadopt}; dropped-invalid log lines ${m.serverLogDroppedInvalid}`
    );
    L.push(
      `server boot to listening ${m.listenMs} ms; all clients connected ${m.allConnectedMs} ms after load start`
    );
  }
  return L.join('\n');
}

(async () => {
  const appSrc = path.resolve(opts.app);
  opts.electronResolved = opts.electron || C.resolveElectron(opts.serverRepo);
  fs.mkdirSync(workRoot, { recursive: true });
  const snap = C.snapshotAppDir(appSrc, path.join(workRoot, 'app'));
  opts.appDirResolved = snap.dir;
  let port = Number(opts.port) || 0;
  if (!port) port = await C.freePort();
  if (await C.portInUse(port)) throw new Error(`port ${port} is in use`);
  patchPort(snap.dir, port);
  C.log(
    `server ${snap.version} from ${appSrc} -> ${snap.dir}; APP_PORT patched to ${port}; electron ${opts.electronResolved}`
  );
  const loadStart = os.loadavg();
  const primed = await prime(port);
  const ns = String(opts.clients)
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((x) => x > 0);
  const scenarios = {};
  for (const n of ns) {
    const runs = [];
    for (let i = 1; i <= opts.runs; i++) {
      const r = await runOnce(n, i, {
        template: primed.sandbox,
        port,
        apiKey: primed.apiKey,
        version: snap.version,
      });
      runs.push(r);
      const c = r.metrics.cpuSeconds || {};
      C.log(
        `N=${n} run ${i}: cpu total ${c.total} (main ${c.main}, renderer ${c.renderer}, gpu ${c.gpu}) CPU-s; rss ${r.metrics.rssMB && r.metrics.rssMB.total} MB; sdk p50 ${r.metrics.lagMs && r.metrics.lagMs.sdkCommand && r.metrics.lagMs.sdkCommand.p50} ms; dropped ${r.metrics.serverLogDroppedInvalid}; unadopt ${r.metrics.load && r.metrics.load.unadopt}`
      );
    }
    scenarios[n] = { median: C.medianTree(runs.map((r) => r.metrics)), runs };
  }
  const res = {
    harness: 'server',
    label,
    version: snap.version,
    appDir: appSrc,
    electron: opts.electronResolved,
    port,
    createdAt: new Date().toISOString(),
    host: {
      cpus: os.cpus().length,
      model: os.cpus()[0] && os.cpus()[0].model,
      loadavgStart: loadStart,
      loadavgEnd: os.loadavg(),
    },
    options: { ...opts, _: undefined },
    scenarios,
  };
  C.writeJson(outFile, res);
  const txt = textSummary(res);
  fs.writeFileSync(outFile.replace(/\.json$/, '.txt'), txt + '\n');
  console.log(txt);
  console.log(`\nresults: ${outFile}`);
  if (!opts.keep)
    fs.rmSync(path.join(primed.sandbox, 'userData'), { recursive: true, force: true });
  process.exit(0);
})().catch(async (e) => {
  console.error(e && e.stack ? e.stack : e);
  await cleanupAndExit(1);
});
