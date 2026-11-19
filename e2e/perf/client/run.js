#!/usr/bin/env node
'use strict';
// ShowTrak Client end-to-end perf harness (macOS).
//
//   node perf/client/run.js --app <client app dir> [options]
//
// See perf/README.md for the options and output format.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const C = require('../lib/common');
const { TreeMonitor, diffCheckpoints } = require('../lib/proctree');
const { killTree, enableInspector, inspectorEval, tail } = require('../lib/app');
const { createFakeServer, summarizeEvents } = require('./fake-server');

const opts = C.parseArgs(process.argv.slice(2), {
  app: null,
  electron: null,
  clientRepo: C.DEFAULT_CLIENT_REPO, // only used to locate the electron binary
  serverRepo: C.DEFAULT_SERVER_REPO, // only used to load socket.io (server)
  runs: 3,
  duration: 180, // steady-state window, seconds
  warmup: 15, // seconds after 'connect' before the window starts
  pollMs: 150,
  oldServer: false,
  configWindow: true,
  configOpenSecs: 15,
  configAfterCloseSecs: 30,
  connectTimeout: 120,
  spawnHook: true,
  label: null,
  out: null,
  keep: false,
});
if (!opts.app) {
  console.error(
    'usage: node client/run.js --app <dir> [--runs 3] [--duration 180] [--old-server] [--out file.json]'
  );
  process.exit(2);
}

const HOOK = path.join(C.HARNESS_ROOT, 'lib', 'spawn-hook.js');
const label =
  opts.label || `${path.basename(path.resolve(opts.app))}${opts.oldServer ? '-oldserver' : ''}`;
const workRoot = path.join(C.OUTPUT_ROOT, `client-${label}-${C.stamp()}`);
const outFile = opts.out || path.join(C.OUTPUT_ROOT, `results-client-${label}-${C.stamp()}.json`);

let currentLaunch = null;
async function cleanupAndExit(code) {
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

function profilePath(appData) {
  return path.join(appData, 'ShowTrakClient', 'Profile', 'Profile.json');
}

async function launchClient({ sandbox, electron, appDir, inspectPort, logName }) {
  const env = C.sandboxEnv({
    home: path.join(sandbox, 'home'),
    appData: path.join(sandbox, 'appdata'),
    extra: {
      ...(opts.spawnHook ? { PERF_SPAWN_TRACE: path.join(sandbox, 'spawns.jsonl') } : {}),
      NODE_OPTIONS: [
        opts.spawnHook ? `--require ${HOOK}` : '',
        inspectPort ? `--inspect-port=127.0.0.1:${inspectPort}` : '',
      ]
        .filter(Boolean)
        .join(' '),
    },
  });
  if (!env.NODE_OPTIONS) delete env.NODE_OPTIONS;
  return C.launchElectron({
    electron,
    appDir,
    userDataDir: path.join(sandbox, 'userData'),
    env,
    logFile: path.join(sandbox, logName || 'app.log'),
    rusageFile: path.join(sandbox, 'rusage.json'),
  });
}

function newSandbox(dir) {
  for (const d of ['home', 'appdata', 'userData'])
    fs.mkdirSync(path.join(dir, d), { recursive: true });
  return dir;
}

async function prime({ electron, appDir, fake, fakePort }) {
  const sandbox = newSandbox(path.join(workRoot, 'template'));
  // A legacy (identity-less) adopted profile: ReconcileIdentity migrates it to
  // this machine's hardware UUID and writes the Identity block, keeping Adopted
  // and Server. After this boot the profile is exactly what an adopted client
  // has on disk, so measured boots do no migration work.
  const pp = profilePath(path.join(sandbox, 'appdata'));
  fs.mkdirSync(path.dirname(pp), { recursive: true });
  fs.writeFileSync(
    pp,
    JSON.stringify(
      {
        UUID: 'perf-seed',
        Adopted: true,
        Server: { IP: '127.0.0.1', Port: fakePort, AdoptionTime: Date.now() },
      },
      null,
      2
    )
  );
  fake.reset();
  C.log('prime: booting client once to let it derive its hardware identity');
  const launch = await launchClient({ sandbox, electron, appDir, fakePort, logName: 'prime.log' });
  currentLaunch = launch;
  try {
    await C.waitFor(() => fake.state.connections.length > 0, {
      timeoutMs: opts.connectTimeout * 1000,
      what: 'prime connection to fake server',
    });
    await C.sleep(5000);
  } catch (e) {
    console.error(tail(path.join(sandbox, 'prime.log')));
    throw e;
  } finally {
    await killTree(launch);
    currentLaunch = null;
  }
  const profile = C.readJson(pp);
  if (
    !profile ||
    !profile.Adopted ||
    !profile.Identity ||
    !profile.UUID ||
    profile.UUID === 'perf-seed'
  ) {
    throw new Error(`prime: unexpected profile after first boot: ${JSON.stringify(profile)}`);
  }
  const q = fake.state.connections[0].query;
  C.log(
    `prime: client UUID ${profile.UUID} (identity source ${profile.Identity.Source}); handshake query ${JSON.stringify(q)}`
  );
  // Start every run from a clean slate apart from the profile (and userData,
  // which a real install would also have).
  for (const f of ['rusage.json', 'rusage.json.pid', 'spawns.jsonl'])
    fs.rmSync(path.join(sandbox, f), { force: true });
  return { sandbox, uuid: profile.UUID, identitySource: profile.Identity.Source };
}

function countBy(list, key) {
  const out = {};
  for (const x of list) {
    const k = typeof key === 'function' ? key(x) : x[key];
    out[k] = (out[k] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
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
const countKind = (cp, kind) => cp.procs.filter((p) => p.helper && p.kind === kind).length;

const CLOSE_CONFIG_WINDOW = `(async () => {
  const { app, BrowserWindow } = process.mainModule.require('electron');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const wins = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w.isVisible());
  const res = [];
  for (const w of wins) {
    // Emulate a user clicking the window and then its close button: the client
    // only hides-to-tray for a close of the focused window.
    try { app.focus({ steal: true }); } catch (e) {}
    try { w.show(); w.focus(); } catch (e) {}
    await sleep(700);
    const focused = w.isFocused();
    // macOS may refuse focus (screen locked / another app active). Then emulate
    // "the focused window was closed" for the app's close handler by making the
    // focus checks it can use report this window, only for the close() call.
    const origIsFocused = w.isFocused;
    const origGetFocused = BrowserWindow.getFocusedWindow;
    if (!focused) {
      w.isFocused = () => true;
      BrowserWindow.getFocusedWindow = () => w;
    }
    try { w.close(); } finally {
      if (!focused) {
        try { w.isFocused = origIsFocused; } catch (e) {}
        BrowserWindow.getFocusedWindow = origGetFocused;
      }
    }
    await sleep(700);
    res.push({ focused, focusEmulated: !focused, destroyed: w.isDestroyed(), visible: !w.isDestroyed() && w.isVisible() });
  }
  return { visibleBefore: wins.length, remaining: BrowserWindow.getAllWindows().length, res };
})()`;

async function configWindowTest({
  launch,
  monitor,
  electron,
  appDir,
  sandbox,
  inspectPort,
  before,
}) {
  const result = { opened: 0 };
  // A second launch with the same user-data-dir hands off to the running
  // instance ('second-instance'), which opens the config window.
  const env = C.sandboxEnv({
    home: path.join(sandbox, 'home'),
    appData: path.join(sandbox, 'appdata'),
  });
  const t0 = Date.now();
  const second = spawn(electron, [appDir, `--user-data-dir=${path.join(sandbox, 'userData')}`], {
    env,
    stdio: 'ignore',
  });
  const secondExit = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        second.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      resolve('timeout');
    }, 20000);
    second.on('exit', (code, sig) => {
      clearTimeout(timer);
      resolve(sig || code);
    });
  });
  result.secondInstanceExit = secondExit;
  const rendererBefore = countKind(before, 'renderer');
  let opened;
  try {
    opened = await C.waitFor(
      async () => {
        const cp = await monitor.checkpoint('cfg-wait');
        return countKind(cp, 'renderer') > rendererBefore ? cp : null;
      },
      { timeoutMs: 20000, intervalMs: 500, what: 'config window renderer' }
    );
  } catch {
    result.error = 'config window renderer did not appear';
    return result;
  }
  result.opened = 1;
  result.openMs = opened.t - t0;
  await C.sleep(opts.configOpenSecs * 1000);
  const open = await monitor.checkpoint('cfg-open');
  let closeInfo;
  try {
    const ws = await enableInspector(launch.mainPid, inspectPort);
    closeInfo = await inspectorEval(ws, CLOSE_CONFIG_WINDOW);
  } catch (e) {
    closeInfo = { error: String(e.message || e) };
  }
  result.closeInfo = closeInfo;
  await C.sleep(opts.configAfterCloseSecs * 1000);
  const after = await monitor.checkpoint('cfg-after-close');
  const rb = rssByKind(before);
  const ro = rssByKind(open);
  const ra = rssByKind(after);
  result.rssMB = {
    before: rb.total,
    open: ro.total,
    afterClose: ra.total,
    leftBehind: Number((ra.total - rb.total).toFixed(1)),
  };
  result.rssMBByKind = { before: rb, open: ro, afterClose: ra };
  result.processes = {
    before: before.procs.filter((p) => p.helper).length,
    open: open.procs.filter((p) => p.helper).length,
    afterClose: after.procs.filter((p) => p.helper).length,
  };
  result.renderers = {
    before: rendererBefore,
    open: countKind(open, 'renderer'),
    afterClose: countKind(after, 'renderer'),
  };
  const r0 = closeInfo && closeInfo.res && closeInfo.res[0];
  result.closeFocused = r0 ? (r0.focused ? 1 : 0) : null;
  result.closeFocusEmulated = r0 ? (r0.focusEmulated ? 1 : 0) : null;
  result.windowDestroyedOnClose = r0 ? (r0.destroyed ? 1 : 0) : null;
  result.windowVisibleAfterClose = r0 ? (r0.visible ? 1 : 0) : null;
  return result;
}

async function runOnce(i, ctx) {
  const { electron, appDir, fake, fakePort, template } = ctx;
  const sandbox = path.join(workRoot, `run-${i}`);
  fs.cpSync(template, sandbox, { recursive: true });
  fake.reset();
  const inspectPort = opts.configWindow ? await C.freePort() : null;
  C.log(`run ${i}: launching`);
  const launch = await launchClient({ sandbox, electron, appDir, fakePort, inspectPort });
  currentLaunch = launch;
  const monitor = new TreeMonitor(launch.mainPid, { intervalMs: opts.pollMs });
  monitor.start();
  const metrics = {};
  const extra = {};
  try {
    const conn = await C.waitFor(() => fake.state.connections[0], {
      timeoutMs: opts.connectTimeout * 1000,
      what: 'client connection',
    });
    metrics.startupMs = conn.t - launch.t0;
    extra.handshakeQuery = conn.query;
    C.log(
      `run ${i}: connected after ${metrics.startupMs} ms; warmup ${opts.warmup}s, window ${opts.duration}s`
    );
    await C.sleep(Math.max(0, conn.t + opts.warmup * 1000 - Date.now()));
    const A = await monitor.checkpoint('t0');
    const wireA = fake.wireSnapshot();
    await C.sleep(opts.duration * 1000);
    const B = await monitor.checkpoint('t1');
    const wireB = fake.wireSnapshot();
    const win = diffCheckpoints(A, B, monitor);
    const secs = win.seconds;

    // First-seen times of key events, relative to launch.
    const firstOf = (name) => {
      const e = fake.state.events.find((x) => x.name === name);
      return e ? e.t - launch.t0 : null;
    };
    metrics.firstHeartbeatMs = firstOf('Heartbeat');
    metrics.firstRunningApplicationsMs = firstOf('RunningApplications');

    // CPU (window), CPU-seconds.
    const cpu = { total: win.totalCpu };
    for (const [k, v] of Object.entries(win.byKind)) cpu[k] = v.cpu;
    metrics.cpuSeconds = cpu;
    metrics.cpuPctOneCore = Number(((win.totalCpu / secs) * 100).toFixed(2));
    metrics.rssMB = rssByKind(B);
    const series = monitor.rssSeries
      .filter((s) => s.t >= A.t && s.t <= B.t)
      .map((s) => s.total / 1024);
    metrics.rssMBAvgTotal = Number((C.mean(series) || 0).toFixed(1));
    metrics.helperProcesses = B.procs.filter((p) => p.helper).length;

    // Child processes: exact (spawn hook) + observed (ps poller).
    const trace = C.readSpawnTrace(path.join(sandbox, 'spawns.jsonl'));
    const spawnsWin = trace.filter((r) => r.ev === 'spawn' && r.t >= A.t && r.t <= B.t);
    const polled = monitor.childrenBetween(A.t, B.t);
    metrics.spawns = {
      hookCount: opts.spawnHook ? spawnsWin.length : null,
      hookPerMinute: opts.spawnHook ? Number(((spawnsWin.length / secs) * 60).toFixed(2)) : null,
      polledUniquePids: polled.length,
      polledCpuLowerBound: Number(polled.reduce((s, p) => s + (p.lastCpu || 0), 0).toFixed(3)),
    };
    extra.spawnsByCommand = countBy(spawnsWin, (r) => r.cmd + (r.sync ? ' (sync)' : ''));
    extra.polledByCommand = countBy(polled, (p) => path.basename(p.comm));

    // Traffic to the server.
    const ev = summarizeEvents(fake.state.events, A.t, B.t);
    metrics.traffic = {
      eventsPerSec: ev.eventsPerSec,
      bytesPerSec: ev.bytesPerSec,
      wireInBytesPerSec: Number(((wireB.inBytes - wireA.inBytes) / secs).toFixed(2)),
      wireOutBytesPerSec: Number(((wireB.outBytes - wireA.outBytes) / secs).toFixed(2)),
      perEvent: Object.fromEntries(
        Object.entries(ev.perEvent).map(([k, v]) => [
          k,
          { perSec: v.perSec, bytesPerSec: v.bytesPerSec, avgBytes: v.avgBytes, count: v.count },
        ])
      ),
    };
    extra.acks = { ...fake.state.acks };
    extra.disconnects = fake.state.connections.filter((c) => c.disconnectedAt).map((c) => c.reason);
    extra.connections = fake.state.connections.length;
    extra.windowProcs = win.procs;
    extra.exitedHelpersInWindow = win.exitedHelpers;

    if (opts.configWindow) {
      C.log(`run ${i}: config window open/close test`);
      metrics.configWindow = await configWindowTest({
        launch,
        monitor,
        electron,
        appDir,
        sandbox,
        inspectPort,
        before: B,
      });
    }
  } finally {
    await monitor.stop();
    const k = await killTree(launch);
    currentLaunch = null;
    // Lifetime accounting of short-lived children via wait4(): subtract helper
    // processes that exited (and so were reaped by main) before the kill.
    const trace = C.readSpawnTrace(path.join(sandbox, 'spawns.jsonl'));
    const lifetimeSpawns = trace.filter((r) => r.ev === 'spawn').length;
    let exitedHelperCpu = 0;
    for (const s of monitor.seen.values()) {
      if (
        s.helper &&
        s.pid !== launch.mainPid &&
        monitor.lastPids &&
        !monitor.lastPids.includes(s.pid)
      ) {
        exitedHelperCpu += s.lastCpu;
      }
    }
    const reaped = k.reapedChildrenCpuLifetime;
    const spawnedCpu = reaped !== null ? Math.max(0, reaped - exitedHelperCpu) : null;
    extra.lifetime = {
      wall: k.rusage ? k.rusage.wall : null,
      mainOwnCpu: k.mainOwnCpu,
      wait4Cpu: k.rusage ? k.rusage.cpu : null,
      reapedChildrenCpu: reaped,
      exitedHelperCpu: Number(exitedHelperCpu.toFixed(3)),
      spawnedChildrenCpu: spawnedCpu !== null ? Number(spawnedCpu.toFixed(3)) : null,
      spawnCount: lifetimeSpawns,
    };
    if (
      metrics.spawns &&
      spawnedCpu !== null &&
      lifetimeSpawns > 0 &&
      metrics.spawns.hookCount !== null
    ) {
      // Average cost per spawn over the whole life x spawns in the window.
      metrics.spawns.lifetimeCpuPerSpawnMs = Number(
        ((spawnedCpu / lifetimeSpawns) * 1000).toFixed(2)
      );
      metrics.spawns.windowCpuEstimate = Number(
        ((spawnedCpu / lifetimeSpawns) * metrics.spawns.hookCount).toFixed(3)
      );
      metrics.cpuSeconds.spawnedChildrenEstimate = metrics.spawns.windowCpuEstimate;
      metrics.cpuSeconds.totalInclChildren = Number(
        (metrics.cpuSeconds.total + metrics.spawns.windowCpuEstimate).toFixed(3)
      );
    }
    if (!opts.keep) {
      // keep logs + traces, drop the bulky Chromium profile
      fs.rmSync(path.join(sandbox, 'userData'), { recursive: true, force: true });
    }
  }
  return { metrics, extra };
}

function textSummary(res) {
  const m = res.median;
  const L = [];
  L.push(
    `ShowTrak Client perf — ${res.label} (v${res.version})${res.options.oldServer ? ' [old-server mode]' : ''}`
  );
  L.push(
    `runs: ${res.runs.length}, window ${res.options.duration}s after ${res.options.warmup}s warmup; medians shown`
  );
  L.push(`startup to socket connect: ${m.startupMs} ms (first Heartbeat ${m.firstHeartbeatMs} ms)`);
  const cpu = m.cpuSeconds || {};
  L.push(
    `CPU-seconds in window: total ${cpu.total} (${m.cpuPctOneCore}% of one core) — ` +
      Object.entries(cpu)
        .filter(([k]) => !['total', 'totalInclChildren', 'spawnedChildrenEstimate'].includes(k))
        .map(([k, v]) => `${k} ${v}`)
        .join(', ')
  );
  if (cpu.spawnedChildrenEstimate !== undefined)
    L.push(
      `  + spawned children (est.) ${cpu.spawnedChildrenEstimate} => ${cpu.totalInclChildren} CPU-s incl. children`
    );
  L.push(
    `RSS at end of window: total ${m.rssMB.total} MB — ` +
      Object.entries(m.rssMB)
        .filter(([k]) => k !== 'total')
        .map(([k, v]) => `${k} ${v}`)
        .join(', ') +
      ` (avg total ${m.rssMBAvgTotal} MB, ${m.helperProcesses} processes)`
  );
  const s = m.spawns || {};
  L.push(
    `child processes in window: ${s.hookCount} spawned (${s.hookPerMinute}/min, hook); ${s.polledUniquePids} seen by ps poller; ~${s.windowCpuEstimate} CPU-s`
  );
  L.push(`  by command (run 1): ${JSON.stringify(res.runs[0].extra.spawnsByCommand)}`);
  const t = m.traffic || {};
  L.push(
    `to server: ${t.eventsPerSec} events/s, ${t.bytesPerSec} B/s payload (${t.wireInBytesPerSec} B/s on the wire)`
  );
  for (const [k, v] of Object.entries(t.perEvent || {}))
    L.push(
      `  ${k.padEnd(24)} ${String(v.perSec).padStart(8)}/s ${String(v.bytesPerSec).padStart(10)} B/s  avg ${v.avgBytes} B`
    );
  if (m.configWindow) {
    const c = m.configWindow;
    L.push(
      `config window: opened ${c.opened}; RSS before ${c.rssMB && c.rssMB.before} MB, open ${c.rssMB && c.rssMB.open} MB, after close ${c.rssMB && c.rssMB.afterClose} MB (left behind ${c.rssMB && c.rssMB.leftBehind} MB); renderers ${JSON.stringify(c.renderers)}; close focused=${c.closeFocused} destroyed=${c.windowDestroyedOnClose} visibleAfter=${c.windowVisibleAfterClose}`
    );
  }
  return L.join('\n');
}

(async () => {
  const appSrc = path.resolve(opts.app);
  const electron = opts.electron || C.resolveElectron(opts.clientRepo);
  fs.mkdirSync(workRoot, { recursive: true });
  const snap = C.snapshotAppDir(appSrc, path.join(workRoot, 'app'));
  C.log(`client ${snap.version} from ${appSrc} -> ${snap.dir}; electron ${electron}`);
  const fake = createFakeServer({
    socketIoRepo: opts.serverRepo,
    oldServer: !!opts.oldServer,
    port: 0,
  });
  const fakePort = await fake.listen();
  C.log(
    `fake server on 127.0.0.1:${fakePort}${opts.oldServer ? ' (old-server: no capability ack)' : ''}`
  );
  const loadStart = os.loadavg();
  const primed = await prime({ electron, appDir: snap.dir, fake, fakePort });
  const runs = [];
  for (let i = 1; i <= opts.runs; i++) {
    const r = await runOnce(i, {
      electron,
      appDir: snap.dir,
      fake,
      fakePort,
      template: primed.sandbox,
    });
    runs.push(r);
    const c = r.metrics.cpuSeconds || {};
    C.log(
      `run ${i}: cpu total ${c.total} CPU-s, rss ${r.metrics.rssMB && r.metrics.rssMB.total} MB, ${r.metrics.traffic && r.metrics.traffic.bytesPerSec} B/s, spawns ${r.metrics.spawns && r.metrics.spawns.hookCount}`
    );
  }
  const samplePayloads = {};
  for (const [k, v] of Object.entries(fake.state.samples))
    samplePayloads[k] = { bytes: v.largestBytes, largest: v.largest };
  const res = {
    harness: 'client',
    label,
    version: snap.version,
    appDir: appSrc,
    electron,
    createdAt: new Date().toISOString(),
    host: {
      cpus: os.cpus().length,
      model: os.cpus()[0] && os.cpus()[0].model,
      loadavgStart: loadStart,
      loadavgEnd: os.loadavg(),
    },
    options: { ...opts, _: undefined },
    clientUUID: primed.uuid,
    identitySource: primed.identitySource,
    median: C.medianTree(runs.map((r) => r.metrics)),
    runs,
    samplePayloadsLastRun: samplePayloads,
  };
  C.writeJson(outFile, res);
  const txt = textSummary(res);
  fs.writeFileSync(outFile.replace(/\.json$/, '.txt'), txt + '\n');
  console.log(txt);
  console.log(`\nresults: ${outFile}`);
  await fake.close();
  if (!opts.keep)
    fs.rmSync(path.join(workRoot, 'template', 'userData'), { recursive: true, force: true });
  process.exit(0);
})().catch(async (e) => {
  console.error(e && e.stack ? e.stack : e);
  await cleanupAndExit(1);
});
