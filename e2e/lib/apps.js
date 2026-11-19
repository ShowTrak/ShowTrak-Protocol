'use strict';
// Running real ShowTrak apps (Server, Client) in a sandbox: snapshot a built
// app dir, move its port, point its data folders into a work dir, launch it,
// and kill everything it started.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawn, spawnSync } = require('node:child_process');
const { sleep } = require('./util');

const IS_WIN = process.platform === 'win32';
const IS_LINUX = process.platform === 'linux';

// Copy dist/ and package.json into dest and link node_modules, so rebuilding the
// source dir mid-run cannot change what is being tested, and so a port patch never
// touches the source.
function snapshotApp(src, dest) {
  src = path.resolve(src);
  if (!fs.existsSync(path.join(src, 'package.json'))) throw new Error(`${src} has no package.json`);
  if (!fs.existsSync(path.join(src, 'dist')))
    throw new Error(`${src} has no dist/ (run npm run build there first)`);
  if (!fs.existsSync(path.join(src, 'node_modules')))
    throw new Error(`${src} has no node_modules (run npm ci there first)`);
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(path.join(src, 'dist'), path.join(dest, 'dist'), { recursive: true });
  fs.copyFileSync(path.join(src, 'package.json'), path.join(dest, 'package.json'));
  const nodeModules = fs.realpathSync(path.join(src, 'node_modules'));
  fs.symlinkSync(nodeModules, path.join(dest, 'node_modules'), IS_WIN ? 'junction' : 'dir');
  const pkg = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8'));
  return { dir: dest, src, version: pkg.version, name: pkg.name };
}

// The real Electron binary the app was built against (not node_modules/.bin/electron,
// which is a node wrapper).
function electronFor(appDir) {
  return createRequire(path.join(appDir, 'package.json'))('electron');
}

function requireFromApp(appDir, mod) {
  return createRequire(path.join(appDir, 'package.json'))(mod);
}

// The server listens on a compiled-in APP_PORT (3000). Rewrite it in the snapshot
// so a sandboxed server never collides with, or adopts clients from, a real one.
// Handles both layouts: per-module dist/ (before 3.32) and the esbuild bundle.
function patchServerPort(appDir, port) {
  let patched = 0;
  const constants = path.join(appDir, 'dist', 'Modules', 'Config', 'constants.js');
  if (fs.existsSync(constants)) {
    const src = fs.readFileSync(constants, 'utf8');
    const next = src.replace(/exports\.APP_PORT\s*=\s*\d+\s*;/, `exports.APP_PORT = ${port};`);
    if (next !== src) patched++;
    fs.writeFileSync(constants, next);
  }
  const bundle = path.join(appDir, 'dist', 'main.bundle.js');
  if (fs.existsSync(bundle)) {
    const src = fs.readFileSync(bundle, 'utf8');
    const re = /(exports\d*)\.APP_PORT\s*=\s*(?:\d+|3e3)\s*;/g;
    const hits = (src.match(re) || []).length;
    if (hits !== 1) throw new Error(`APP_PORT found ${hits} times in ${bundle}, expected 1`);
    fs.writeFileSync(bundle, src.replace(re, `$1.APP_PORT = ${port};`));
    patched++;
  }
  if (!patched) throw new Error(`Could not find APP_PORT to patch in ${appDir}/dist`);
}

// A sandbox is a folder with home/, appdata/ and userData/ that the app treats as
// its user profile.
function makeSandbox(dir) {
  for (const d of ['home', 'appdata', 'userData'])
    fs.mkdirSync(path.join(dir, d), { recursive: true });
  return {
    dir,
    home: path.join(dir, 'home'),
    appData: path.join(dir, 'appdata'),
    userData: path.join(dir, 'userData'),
  };
}

// Where ShowTrak Server keeps its data inside a sandbox (mirrors Modules/AppData).
function serverDataDir(sandbox) {
  if (IS_WIN) return path.join(sandbox.appData, 'ShowTrakServer');
  if (process.platform === 'darwin')
    return path.join(sandbox.home, 'Library', 'Application Support', 'ShowTrakServer');
  return path.join(sandbox.home, '.local', 'share', 'ShowTrakServer');
}

// The client honours APPDATA on every platform.
function clientDataDir(sandbox) {
  return path.join(sandbox.appData, 'ShowTrakClient');
}

// Environment for a sandboxed app. ELECTRON_RUN_AS_NODE (set by some tools and
// agent shells) would turn Electron into plain node; strip it and anything else
// that could redirect the app.
function sandboxEnv(sandbox, extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (
      k.startsWith('ELECTRON_') ||
      k === 'NODE_OPTIONS' ||
      k === 'NODE_ENV' ||
      k.startsWith('XDG_DATA') ||
      k.startsWith('XDG_CONFIG')
    ) {
      delete env[k];
    }
  }
  env.HOME = sandbox.home;
  env.APPDATA = sandbox.appData;
  env.CFFIXED_USER_HOME = sandbox.home;
  if (IS_WIN) env.USERPROFILE = sandbox.home;
  return { ...env, ...extra };
}

// Chromium flags needed to run on a headless Linux CI box (under xvfb-run).
function platformFlags() {
  if (!IS_LINUX) return [];
  return ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'];
}

// Launch `electron <appDir>` in its own process group, logging stdout/stderr.
function launchApp({ appDir, sandbox, args = [], logFile, env }) {
  if (IS_LINUX && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    throw new Error(
      'No display. On Linux run under xvfb-run (e.g. xvfb-run -a node interop.js ...).'
    );
  }
  const out = fs.openSync(logFile, 'a');
  const proc = spawn(
    electronFor(appDir),
    [appDir, `--user-data-dir=${sandbox.userData}`, ...platformFlags(), ...args],
    { env: env || sandboxEnv(sandbox), stdio: ['ignore', out, out], detached: !IS_WIN }
  );
  fs.closeSync(out);
  const launch = { proc, pid: proc.pid, logFile, exited: false };
  proc.on('exit', (code, signal) => {
    launch.exited = true;
    launch.exitCode = code;
    launch.exitSignal = signal;
  });
  return launch;
}

function descendants(rootPid) {
  if (IS_WIN) return [];
  const res = spawnSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' });
  const children = new Map();
  for (const line of (res.stdout || '').split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (!pid) continue;
    if (!children.has(ppid)) children.set(ppid, []);
    children.get(ppid).push(pid);
  }
  const out = [];
  const stack = [rootPid];
  while (stack.length) {
    for (const child of children.get(stack.pop()) || []) {
      out.push(child);
      stack.push(child);
    }
  }
  return out;
}

// SIGKILL the app and everything it started, so no quit or save flow runs.
async function killApp(launch) {
  if (!launch || !launch.pid) return;
  launch.killed = true;
  if (IS_WIN) {
    spawnSync('taskkill', ['/PID', String(launch.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  const tree = descendants(launch.pid);
  try {
    process.kill(-launch.pid, 'SIGKILL');
  } catch {
    /* group already gone */
  }
  for (const pid of [launch.pid, ...tree]) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* gone */
    }
  }
  for (let i = 0; i < 30 && !launch.exited; i++) await sleep(100);
}

// Every line in the sandbox's *.log files that matches re (first `limit`).
function scanLogs(dir, re, limit = 25) {
  const hits = [];
  const walk = (d) => {
    for (const entry of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'userData') walk(p);
      } else if (/\.log$/.test(entry.name)) {
        for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
          if (re.test(line)) hits.push(`${path.relative(dir, p)}: ${line.slice(0, 240)}`);
          if (hits.length >= limit) return;
        }
      }
    }
  };
  walk(dir);
  return hits;
}

module.exports = {
  IS_WIN,
  IS_LINUX,
  snapshotApp,
  electronFor,
  requireFromApp,
  patchServerPort,
  makeSandbox,
  serverDataDir,
  clientDataDir,
  sandboxEnv,
  launchApp,
  killApp,
  scanLogs,
};
