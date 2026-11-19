'use strict';
// Process-tree accounting for an Electron app on macOS, via ps.
//
//  - CPU is ps `time` (user+sys CPU-seconds, 10 ms resolution) per pid; window
//    CPU = time(t1) - time(t0) per pid, so a busy machine does not distort it the
//    way %CPU would.
//  - RSS is ps `rss` (KiB). Electron helpers share pages, so the sum over-counts
//    shared memory; it is still comparable run to run.
//  - A poller runs ps every `intervalMs` to record every descendant pid ever seen
//    (helpers and short-lived children such as lsappinfo/vm_stat), with the last
//    CPU time seen for each.
const path = require('path');
const { execFileP, sleep } = require('./common');

function parseCpuTime(s) {
  // macOS: "m:ss.cc" (minutes may exceed 59); be lenient with [[dd-]hh:]mm:ss.
  if (!s) return 0;
  let days = 0;
  let rest = s.trim();
  const dash = rest.indexOf('-');
  if (dash > 0) {
    days = Number(rest.slice(0, dash));
    rest = rest.slice(dash + 1);
  }
  const parts = rest.split(':').map(Number);
  let secs = 0;
  for (const p of parts) secs = secs * 60 + p;
  return days * 86400 + secs;
}

async function psAll() {
  const out = await execFileP('/bin/ps', ['-axo', 'pid=,ppid=,time=,rss=,comm=']);
  const map = new Map();
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    map.set(Number(m[1]), {
      pid: Number(m[1]),
      ppid: Number(m[2]),
      cpu: parseCpuTime(m[3]),
      rss: Number(m[4]),
      comm: m[5],
    });
  }
  return map;
}

async function psArgs(pids) {
  if (!pids.length) return new Map();
  let out;
  try {
    out = await execFileP('/bin/ps', ['-ww', '-o', 'pid=,args=', '-p', pids.join(',')]);
  } catch (e) {
    out = e.stdout || ''; // ps exits 1 when some pid vanished
  }
  const map = new Map();
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (m) map.set(Number(m[1]), m[2]);
  }
  return map;
}

function descendantsOf(map, rootPid) {
  const children = new Map();
  for (const p of map.values()) {
    if (!children.has(p.ppid)) children.set(p.ppid, []);
    children.get(p.ppid).push(p.pid);
  }
  const out = [];
  const stack = [rootPid];
  while (stack.length) {
    const pid = stack.pop();
    for (const c of children.get(pid) || []) {
      out.push(c);
      stack.push(c);
    }
  }
  return out;
}

function isElectronHelper(comm) {
  return /Electron Helper|\.app\/Contents\/Frameworks\/.*Helper/.test(comm || '');
}

// Classify a process from its args (falls back to comm).
function classify(args, comm, isMain) {
  if (isMain) return 'main';
  const a = args || '';
  const type = /--type=([\w-]+)/.exec(a);
  if (type) {
    const t = type[1];
    if (t === 'renderer') return 'renderer';
    if (t === 'gpu-process') return 'gpu';
    if (t === 'utility') {
      const sub = /--utility-sub-type=([\w.]+)/.exec(a);
      const s = sub ? sub[1] : 'unknown';
      if (/network/i.test(s)) return 'utility:network';
      if (/audio/i.test(s)) return 'utility:audio';
      if (/storage/i.test(s)) return 'utility:storage';
      return `utility:${s}`;
    }
    return t;
  }
  return `child:${path.basename(comm || a.split(' ')[0] || '?')}`;
}

class TreeMonitor {
  constructor(rootPid, { intervalMs = 150 } = {}) {
    this.rootPid = rootPid;
    this.intervalMs = intervalMs;
    this.seen = new Map(); // pid -> { pid, ppid, comm, firstSeen, lastSeen, firstCpu, lastCpu, maxRss, helper }
    this.running = false;
    this.samples = 0;
    this.rssSeries = []; // { t, total, byPid: {pid: rss} } every rssEveryMs
    this.rssEveryMs = 5000;
    this._lastRssAt = 0;
  }
  start() {
    this.running = true;
    this._loop = (async () => {
      while (this.running) {
        const t = Date.now();
        try {
          await this.pollOnce();
        } catch {
          /* ignore */
        }
        const spent = Date.now() - t;
        await sleep(Math.max(10, this.intervalMs - spent));
      }
    })();
  }
  async stop() {
    this.running = false;
    if (this._loop) await this._loop;
  }
  async pollOnce() {
    const map = await psAll();
    const now = Date.now();
    this.samples++;
    const root = map.get(this.rootPid);
    const pids = root ? [this.rootPid, ...descendantsOf(map, this.rootPid)] : [];
    for (const pid of pids) {
      const p = map.get(pid);
      let s = this.seen.get(pid);
      if (!s || s.comm !== p.comm) {
        s = {
          pid,
          ppid: p.ppid,
          comm: p.comm,
          firstSeen: now,
          lastSeen: now,
          firstCpu: p.cpu,
          lastCpu: p.cpu,
          maxRss: p.rss,
          helper: pid === this.rootPid || isElectronHelper(p.comm),
        };
        this.seen.set(pid, s);
      }
      s.lastSeen = now;
      s.lastCpu = p.cpu;
      if (p.rss > s.maxRss) s.maxRss = p.rss;
    }
    if (now - this._lastRssAt >= this.rssEveryMs && pids.length) {
      this._lastRssAt = now;
      const byPid = {};
      let total = 0;
      for (const pid of pids) {
        byPid[pid] = map.get(pid).rss;
        total += map.get(pid).rss;
      }
      this.rssSeries.push({ t: now, total, byPid });
    }
    this.lastMap = map;
    this.lastPids = pids;
    return { map, pids };
  }
  // Full snapshot with classification. Returns { t, procs: [{pid, kind, cpu, rss, comm, args}] }
  async checkpoint(label) {
    const map = await psAll();
    const t = Date.now();
    const pids = map.get(this.rootPid) ? [this.rootPid, ...descendantsOf(map, this.rootPid)] : [];
    const args = await psArgs(pids);
    const procs = pids.map((pid) => {
      const p = map.get(pid);
      return {
        pid,
        ppid: p.ppid,
        kind: classify(args.get(pid), p.comm, pid === this.rootPid),
        cpu: p.cpu,
        rss: p.rss,
        comm: path.basename(p.comm),
        helper: pid === this.rootPid || isElectronHelper(p.comm),
      };
    });
    return { label, t, procs };
  }
  // Short-lived (non-helper) descendants first seen within [t0, t1].
  childrenBetween(t0, t1) {
    const list = [];
    for (const s of this.seen.values()) {
      if (s.helper) continue;
      if (s.firstSeen < t0 || s.firstSeen > t1) continue;
      list.push(s);
    }
    return list;
  }
  allDescendantPids() {
    return Array.from(this.seen.keys());
  }
}

// CPU/RSS deltas between two checkpoints, grouped by process kind. Helpers that
// appeared after `a` count from 0; ones that died before `b` are reported in
// `exitedHelpers` (their CPU since `a` is unknown beyond the poller's last view).
function diffCheckpoints(a, b, monitor) {
  const before = new Map(a.procs.map((p) => [p.pid, p]));
  const byKind = {};
  const procs = [];
  for (const p of b.procs) {
    if (!p.helper) continue; // short-lived children are accounted separately
    const prev = before.get(p.pid);
    const cpu = p.cpu - (prev ? prev.cpu : 0);
    const k = p.kind;
    byKind[k] = byKind[k] || { cpu: 0, rssKB: 0, count: 0 };
    byKind[k].cpu += cpu;
    byKind[k].rssKB += p.rss;
    byKind[k].count += 1;
    procs.push({
      pid: p.pid,
      kind: k,
      cpu: Number(cpu.toFixed(2)),
      rssKB: p.rss,
      newInWindow: !prev,
    });
  }
  const exitedHelpers = [];
  for (const p of a.procs) {
    if (!p.helper) continue;
    if (!b.procs.find((q) => q.pid === p.pid)) {
      const s = monitor && monitor.seen.get(p.pid);
      exitedHelpers.push({
        pid: p.pid,
        kind: p.kind,
        cpuSeen: s ? Number((s.lastCpu - p.cpu).toFixed(2)) : null,
      });
    }
  }
  const totalCpu = Object.values(byKind).reduce((s, v) => s + v.cpu, 0);
  const totalRssKB = Object.values(byKind).reduce((s, v) => s + v.rssKB, 0);
  for (const v of Object.values(byKind)) v.cpu = Number(v.cpu.toFixed(3));
  return {
    seconds: (b.t - a.t) / 1000,
    totalCpu: Number(totalCpu.toFixed(3)),
    totalRssKB,
    byKind,
    procs,
    exitedHelpers,
  };
}

module.exports = {
  psAll,
  psArgs,
  descendantsOf,
  classify,
  TreeMonitor,
  diffCheckpoints,
  parseCpuTime,
  isElectronHelper,
};
