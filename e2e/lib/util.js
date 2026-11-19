'use strict';
// Small helpers shared by every e2e script: argv parsing, waiting, ports,
// logging and version comparison. No dependencies beyond Node itself.
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { execFile } = require('node:child_process');

const E2E_ROOT = path.resolve(__dirname, '..');
// Where runs keep their sandboxes and logs. Override with ST_E2E_WORK.
const WORK_ROOT = process.env.ST_E2E_WORK || path.join(E2E_ROOT, 'work');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --flag value | --flag=value | --flag (true) | --no-flag (false).
// Kebab-case keys become camelCase; a numeric default makes the value a number.
function parseArgs(argv, defaults = {}) {
  const out = { ...defaults, _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      out._.push(arg);
      continue;
    }
    let key = arg.slice(2);
    let value;
    const eq = key.indexOf('=');
    if (eq >= 0) {
      value = key.slice(eq + 1);
      key = key.slice(0, eq);
    } else if (key.startsWith('no-')) {
      key = key.slice(3);
      value = false;
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      value = argv[++i];
    } else {
      value = true;
    }
    const camel = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (typeof defaults[camel] === 'number' && typeof value === 'string') value = Number(value);
    out[camel] = value;
  }
  return out;
}

// Poll fn until it returns something truthy. Exceptions count as "not yet".
// With rethrow, an exception from fn ends the wait at once (fail fast).
async function waitFor(
  fn,
  { timeoutMs = 30000, intervalMs = 200, what = 'condition', rethrow = false } = {}
) {
  const start = Date.now();
  for (;;) {
    let value;
    try {
      value = await fn();
    } catch (err) {
      if (rethrow) throw err;
      value = null;
    }
    if (value) return value;
    if (Date.now() - start > timeoutMs)
      throw new Error(`Timed out after ${timeoutMs} ms waiting for ${what}`);
    await sleep(intervalMs);
  }
}

// Like waitFor, but resolves null on timeout instead of throwing.
async function poll(fn, timeoutMs = 15000, intervalMs = 100) {
  try {
    return await waitFor(fn, { timeoutMs, intervalMs });
  } catch {
    return null;
  }
}

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
    const socket = net.connect({ port, host });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(false);
    });
  });
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

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function log(...parts) {
  process.stderr.write(`[${new Date().toISOString().slice(11, 19)}] ${parts.join(' ')}\n`);
}

// A fresh, uniquely named directory under WORK_ROOT.
function workDir(label) {
  const dir = path.join(WORK_ROOT, `${label}-${stamp()}-${process.pid}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

// "3.32.0-beta.4" -> [3, 32, 0, -1, 4]: a pre-release sorts before its release.
function versionKey(version) {
  const [core, pre] = String(version).replace(/^v/, '').split('-');
  const nums = core.split('.').map((n) => Number(n) || 0);
  while (nums.length < 3) nums.push(0);
  if (!pre) return [...nums, 0, 0];
  const preNum = Number((pre.match(/(\d+)$/) || [])[1] || 0);
  return [...nums, -1, preNum];
}

function compareVersions(a, b) {
  const ka = versionKey(a);
  const kb = versionKey(b);
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
  return 0;
}

const atLeast = (version, min) => compareVersions(version, min) >= 0;

// Records named checks and prints them as PASS / FAIL / SKIP lines.
class Checks {
  constructor(prefix = '') {
    this.prefix = prefix;
    this.list = [];
  }
  add(name, ok, detail = '') {
    const entry = {
      name,
      ok: !!ok,
      detail: typeof detail === 'string' ? detail : JSON.stringify(detail),
    };
    this.list.push(entry);
    const tag = this.prefix ? `[${this.prefix}] ` : '';
    console.log(
      `  ${entry.ok ? 'PASS' : 'FAIL'}  ${tag}${name}${entry.ok ? '' : `  -> ${entry.detail.slice(0, 600)}`}`
    );
    return entry.ok;
  }
  skip(name, why) {
    this.list.push({ name, ok: true, skipped: true, detail: why });
    const tag = this.prefix ? `[${this.prefix}] ` : '';
    console.log(`  SKIP  ${tag}${name}  (${why})`);
  }
  get failed() {
    return this.list.filter((c) => !c.ok);
  }
  summary() {
    const ran = this.list.filter((c) => !c.skipped);
    return `${ran.length - this.failed.length}/${ran.length} checks passed${this.list.length > ran.length ? `, ${this.list.length - ran.length} skipped` : ''}`;
  }
}

module.exports = {
  E2E_ROOT,
  WORK_ROOT,
  sleep,
  parseArgs,
  waitFor,
  poll,
  freePort,
  portInUse,
  execFileP,
  stamp,
  log,
  workDir,
  readJson,
  compareVersions,
  atLeast,
  Checks,
};
