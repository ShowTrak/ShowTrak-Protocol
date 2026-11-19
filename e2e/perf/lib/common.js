'use strict';
// Shared helpers for the ShowTrak perf harnesses (macOS only).
const fs = require('fs');
const net = require('net');
const path = require('path');
const { createRequire } = require('module');
const { spawn, execFile } = require('child_process');

const HARNESS_ROOT = path.resolve(__dirname, '..');
// Run output (sandboxes, logs, results) goes under the e2e work root, never into
// the repo. The ShowTrak checkouts default to siblings of ShowTrak-Protocol;
// override with SHOWTRAK_CODEBASE or --server-repo / --client-repo.
const OUTPUT_ROOT = path.join(
  process.env.ST_E2E_WORK || path.resolve(HARNESS_ROOT, '..', 'work'),
  'perf'
);
const CODEBASE = process.env.SHOWTRAK_CODEBASE || path.resolve(HARNESS_ROOT, '..', '..', '..');
const DEFAULT_CLIENT_REPO = path.join(CODEBASE, 'ShowTrakClient');
const DEFAULT_SERVER_REPO = path.join(CODEBASE, 'ShowTrakServer');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- argv ----------------------------------------------------------------------
// --flag value | --flag=value | --flag (boolean) | --no-flag (false)
function parseArgs(argv, defaults = {}) {
  const out = { ...defaults, _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    let key = a.slice(2);
    let val;
    const eq = key.indexOf('=');
    if (eq >= 0) {
      val = key.slice(eq + 1);
      key = key.slice(0, eq);
    } else if (key.startsWith('no-')) {
      key = key.slice(3);
      val = false;
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      val = argv[++i];
    } else {
      val = true;
    }
    const camel = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const def = defaults[camel];
    if (typeof def === 'number' && typeof val === 'string') val = Number(val);
    out[camel] = val;
  }
  return out;
}

// --- stats ---------------------------------------------------------------------
function median(values) {
  const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
function percentile(values, p) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const idx = Math.min(v.length - 1, Math.max(0, Math.ceil((p / 100) * v.length) - 1));
  return v[idx];
}
function mean(values) {
  const v = values.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
const round = (x, d = 3) =>
  typeof x === 'number' && Number.isFinite(x) ? Number(x.toFixed(d)) : x;

// Median of every numeric leaf across N same-shaped result objects. Non-numeric
// leaves are taken from the first run. Arrays are kept from the first run.
function medianTree(objs) {
  const first = objs[0];
  if (first === null || first === undefined) return first;
  if (typeof first === 'number') return round(median(objs), 4);
  if (Array.isArray(first) || typeof first !== 'object') return first;
  const keys = new Set();
  for (const o of objs) if (o && typeof o === 'object') Object.keys(o).forEach((k) => keys.add(k));
  const out = {};
  for (const k of keys) {
    const vals = objs.map((o) => (o && typeof o === 'object' ? o[k] : undefined));
    const defined = vals.filter((v) => v !== undefined);
    if (!defined.length) continue;
    if (defined.every((v) => typeof v === 'number')) {
      // A key missing in some runs counts as 0 (e.g. an event that never fired).
      out[k] = round(median(vals.map((v) => (v === undefined ? 0 : v))), 4);
    } else {
      out[k] = medianTree(defined);
    }
  }
  return out;
}

// --- ports ---------------------------------------------------------------------
function freePort(host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, host, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}
function portInUse(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const s = net.connect({ port, host });
    s.once('connect', () => {
      s.destroy();
      resolve(true);
    });
    s.once('error', () => resolve(false));
    s.setTimeout(1000, () => {
      s.destroy();
      resolve(false);
    });
  });
}
async function waitFor(fn, { timeoutMs = 30000, intervalMs = 200, what = 'condition' } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs)
      throw new Error(`Timed out after ${timeoutMs}ms waiting for ${what}`);
    await sleep(intervalMs);
  }
}

// --- app dirs ------------------------------------------------------------------
// Resolve the real Electron binary (NOT node_modules/.bin/electron, which is a
// node wrapper that would add a process to the tree).
function resolveElectron(repoDir) {
  const req = createRequire(path.join(repoDir, 'package.json'));
  return req('electron');
}
function requireFrom(repoDir, mod) {
  return createRequire(path.join(repoDir, 'package.json'))(mod);
}

// Copy dist/ + package.json into dest and symlink node_modules, so a rebuild of
// the source app dir mid-run cannot change what is being measured.
function snapshotAppDir(src, dest) {
  src = path.resolve(src);
  if (!fs.existsSync(path.join(src, 'package.json'))) throw new Error(`${src} has no package.json`);
  if (!fs.existsSync(path.join(src, 'dist')))
    throw new Error(`${src} has no dist/ (build it first)`);
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(path.join(src, 'dist'), path.join(dest, 'dist'), {
    recursive: true,
    dereference: false,
  });
  fs.copyFileSync(path.join(src, 'package.json'), path.join(dest, 'package.json'));
  const nm = fs.realpathSync(path.join(src, 'node_modules'));
  fs.symlinkSync(nm, path.join(dest, 'node_modules'));
  const pkg = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8'));
  return { dir: dest, version: pkg.version, name: pkg.name, nodeModules: nm };
}

// Environment for a sandboxed app run. ELECTRON_RUN_AS_NODE is set in this
// agent's shell and would turn Electron into plain node; strip it and anything
// else Electron-ish that could change behaviour.
function sandboxEnv({ home, appData, extra = {} }) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (k.startsWith('ELECTRON_') || k === 'NODE_OPTIONS' || k === 'NODE_ENV') delete env[k];
  }
  env.HOME = home;
  if (appData) env.APPDATA = appData;
  env.CFFIXED_USER_HOME = home; // CoreFoundation's own home override (best effort)
  return { ...env, ...extra };
}

// Launch `electron <appDir> ...flags` under lib/launch.py (wait4 rusage).
// Returns { launcherPid, mainPid (promise), rusageFile, t0, proc }.
async function launchElectron({
  electron,
  appDir,
  userDataDir,
  env,
  extraArgs = [],
  logFile,
  rusageFile,
}) {
  const args = [
    path.join(HARNESS_ROOT, 'lib', 'launch.py'),
    rusageFile,
    electron,
    appDir,
    `--user-data-dir=${userDataDir}`,
    ...extraArgs,
  ];
  const out = fs.openSync(logFile, 'a');
  const t0 = Date.now();
  const proc = spawn('python3', args, { env, stdio: ['ignore', out, out], detached: false });
  fs.closeSync(out);
  const pidFile = rusageFile + '.pid';
  const mainPid = await waitFor(
    () => {
      try {
        const v = Number(fs.readFileSync(pidFile, 'utf8').trim());
        return v > 0 ? v : null;
      } catch {
        return null;
      }
    },
    { timeoutMs: 10000, intervalMs: 20, what: 'launcher pid file' }
  );
  return { proc, launcherPid: proc.pid, mainPid, t0, rusageFile };
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

function execFileP(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      } else resolve(stdout);
    });
  });
}

// Read spawn-hook trace lines.
function readSpawnTrace(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function log(...a) {
  const d = new Date();
  process.stderr.write(`[${d.toISOString().slice(11, 19)}] ${a.join(' ')}\n`);
}

module.exports = {
  HARNESS_ROOT,
  OUTPUT_ROOT,
  CODEBASE,
  DEFAULT_CLIENT_REPO,
  DEFAULT_SERVER_REPO,
  sleep,
  parseArgs,
  median,
  mean,
  percentile,
  round,
  medianTree,
  freePort,
  portInUse,
  waitFor,
  resolveElectron,
  requireFrom,
  snapshotAppDir,
  sandboxEnv,
  launchElectron,
  readJson,
  writeJson,
  execFileP,
  readSpawnTrace,
  stamp,
  log,
};
