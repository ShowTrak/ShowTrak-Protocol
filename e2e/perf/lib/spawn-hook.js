// Loaded into the Electron MAIN process via NODE_OPTIONS=--require (unpackaged
// Electron honours it). Logs every child process the app starts, with its pid,
// so the harness can count spawns exactly (ps polling misses short-lived ones).
// Writes one JSON line per event to $PERF_SPAWN_TRACE. Never throws.
'use strict';
(function installSpawnHook() {
  const file = process.env.PERF_SPAWN_TRACE;
  if (!file || !process.versions || !process.versions.electron) return;
  if (process.type && process.type !== 'browser') return;
  let fs, cp, path;
  try {
    fs = require('fs');
    cp = require('child_process');
    path = require('path');
  } catch {
    return;
  }
  const log = (rec) => {
    try {
      fs.appendFileSync(file, JSON.stringify(rec) + '\n');
    } catch {
      /* ignore */
    }
  };
  const short = (v) => String(v).slice(0, 120);
  const name = (f) => (f ? path.basename(String(f)) : '?');
  const proto = cp.ChildProcess && cp.ChildProcess.prototype;
  if (proto && typeof proto.spawn === 'function') {
    const orig = proto.spawn;
    proto.spawn = function hookedSpawn(options) {
      const result = orig.apply(this, arguments);
      try {
        const pid = this.pid;
        const args = (options && Array.isArray(options.args) ? options.args.slice(1, 6) : []).map(
          short
        );
        log({
          t: Date.now(),
          ev: 'spawn',
          pid,
          cmd: name(options && options.file),
          args,
          sync: false,
        });
        if (pid) {
          this.once('exit', (code, sig) => log({ t: Date.now(), ev: 'exit', pid, code, sig }));
        }
      } catch {
        /* ignore */
      }
      return result;
    };
  }
  for (const fn of ['spawnSync', 'execFileSync', 'execSync']) {
    const orig = cp[fn];
    if (typeof orig !== 'function') continue;
    cp[fn] = function hookedSync(file) {
      const t0 = Date.now();
      try {
        return orig.apply(this, arguments);
      } finally {
        const cmd = fn === 'execSync' ? short(file).split(/\s+/)[0] : name(file);
        log({ t: t0, ev: 'spawn', pid: null, cmd, sync: true, ms: Date.now() - t0, via: fn });
      }
    };
  }
})();
