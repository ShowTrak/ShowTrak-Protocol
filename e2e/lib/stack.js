'use strict';
// Bring up one real ShowTrak Server with one real ShowTrak Client adopted by it,
// both sandboxed, on a free port. Used by interop.js and companion/run.js.
//
// Adoption is seeded straight into the server's database (the client's row keyed
// by the hardware UUID the client will derive), and the client boots with a legacy
// adopted Profile.json pointing at the server, exactly like an upgraded install.
// That works on every version without driving any UI.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const U = require('./util');
const A = require('./apps');
const DB = require('./db');

const CLIENT_SLUG = 'e2e-host';

// A script that prints to stdout and stderr over a couple of seconds, and one
// that fails. Each runs on macOS, Linux and Windows.
const SCRIPTS = {
  Console_Check: {
    name: 'Console Check',
    sh: '#!/bin/sh\necho "console check starting"\nsleep 1\necho "step 1 of 3"\necho "warning: example stderr line" >&2\necho "step 2 of 3"\nsleep 1\necho "step 3 of 3"\necho "done"\n',
    bat: '@echo off\r\necho console check starting\r\nping -n 2 127.0.0.1 >nul\r\necho step 1 of 3\r\necho warning: example stderr line 1>&2\r\necho step 2 of 3\r\nping -n 2 127.0.0.1 >nul\r\necho step 3 of 3\r\necho done\r\n',
  },
  Fail_Check: {
    name: 'Fail Check',
    sh: '#!/bin/sh\necho "about to fail" >&2\nsleep 1\nexit 3\n',
    bat: '@echo off\r\necho about to fail 1>&2\r\nping -n 2 127.0.0.1 >nul\r\nexit /b 3\r\n',
  },
};

function addScript(serverData, id, { name, sh, bat }) {
  const dir = path.join(serverData, 'Scripts', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'run.sh'), sh, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'run.bat'), bat);
  const manifest = {
    Name: name,
    Description: name,
    Colour: 4,
    Icon: 'terminal',
    Weight: 1,
    Confirmation: false,
    Timeout: 15000,
    Enabled: true,
    Platforms: { Windows: 'run.bat', macOS: 'run.sh', Linux: 'run.sh' },
    Arguments: { Windows: '', macOS: '', Linux: '' },
  };
  fs.writeFileSync(path.join(dir, 'Script.json'), JSON.stringify(manifest, null, 2));
}

// The hardware UUID the client will derive on this machine, computed by the
// client's own module in a separate node process (its Logger opens a log file
// under APPDATA, so that is pointed into the work dir).
function clientHardwareUUID(clientDir, work) {
  const modulePath = path.join(clientDir, 'dist', 'Modules', 'HardwareIdentity', 'index.js');
  if (!fs.existsSync(modulePath)) {
    throw new Error(
      `Client ${clientDir} has no HardwareIdentity module (too old for this harness)`
    );
  }
  const appData = path.join(work, 'hwid-appdata');
  fs.mkdirSync(appData, { recursive: true });
  const script = `require(${JSON.stringify(modulePath)}).Manager.Resolve().then((r) => { process.stdout.write(JSON.stringify(r)); process.exit(0); }, (e) => { console.error(e); process.exit(1); });`;
  const res = spawnSync(process.execPath, ['-e', script], {
    env: { ...process.env, APPDATA: appData, ELECTRON_RUN_AS_NODE: '' },
    encoding: 'utf8',
    timeout: 60000,
  });
  if (res.status !== 0)
    throw new Error(`Could not derive the client's hardware UUID: ${res.stderr || res.error}`);
  const out = res.stdout.trim().split('\n').pop();
  return JSON.parse(out);
}

// The first "Error:" line of an app's stdout log, for a readable failure.
function firstError(logFile) {
  try {
    const line = fs
      .readFileSync(logFile, 'utf8')
      .split('\n')
      .find((l) => /Error:/.test(l));
    return line ? line.trim().slice(0, 300) : 'see log';
  } catch {
    return 'see log';
  }
}

function osName() {
  return process.platform === 'win32'
    ? 'Windows'
    : process.platform === 'darwin'
      ? 'macOS'
      : 'Linux';
}

/**
 * @param {object} o
 * @param {string} o.server  built ShowTrakServer dir (dist/ + node_modules)
 * @param {string} o.client  built ShowTrakClient dir
 * @param {string} o.work    work dir for this run
 * @param {boolean} [o.scripts]  add Console_Check / Fail_Check
 * @param {number} [o.devtools]  open a DevTools port on the server renderer
 */
async function startStack({
  server: serverSrc,
  client: clientSrc,
  work,
  scripts = true,
  devtools = 0,
}) {
  const launches = [];
  const stack = { work, launches, clientSlug: CLIENT_SLUG };
  stack.stop = async () => {
    for (const l of launches.slice().reverse()) await A.killApp(l);
  };
  try {
    const port = await U.freePort();
    const server = A.snapshotApp(serverSrc, path.join(work, 'server-app'));
    const client = A.snapshotApp(clientSrc, path.join(work, 'client-app'));
    A.patchServerPort(server.dir, port);
    Object.assign(stack, { port, server, client, url: `http://127.0.0.1:${port}` });
    U.log(
      `server ${server.version} (${server.src}) on ${port}; client ${client.version} (${client.src})`
    );

    const sBox = A.makeSandbox(path.join(work, 'server'));
    const sData = A.serverDataDir(sBox);
    const dbFile = path.join(sData, 'Storage', 'DB.sqlite');
    Object.assign(stack, { serverSandbox: sBox, serverData: sData, dbFile });
    const launchServer = (logName, args = []) => {
      const l = A.launchApp({
        appDir: server.dir,
        sandbox: sBox,
        args,
        logFile: path.join(sBox.dir, logName),
      });
      launches.push(l);
      return l;
    };

    // Wait for the server to listen, but give up at once if it exited or failed
    // to load (it can log a fatal error and stay alive without a window).
    const waitListening = (launch, what) =>
      U.waitFor(
        async () => {
          if (launch.exited)
            throw new Error(
              `server exited (${launch.exitCode ?? launch.exitSignal}) during ${what}`
            );
          const fatal = A.scanLogs(sBox.dir, /App threw an error during load/, 1);
          if (fatal.length)
            throw new Error(`server failed to load during ${what}: ${firstError(launch.logFile)}`);
          return U.portInUse(port);
        },
        { timeoutMs: 120000, what, rethrow: true }
      );

    // 1. Prime boot: creates the working DB, settings and the SDK API key.
    const prime = launchServer('prime.log');
    await waitListening(prime, 'server port (first boot)');
    stack.apiKey = await U.waitFor(() => DB.setting(dbFile, 'SDK_API_KEY'), {
      timeoutMs: 30000,
      what: 'SDK API key',
    });
    await U.sleep(3000);
    await A.killApp(prime);
    await U.sleep(1000);

    // 2. Seed: the adopted client, show file metadata, scripts.
    const identity = clientHardwareUUID(client.dir, work);
    stack.uuid = identity.UUID;
    U.log(`client hardware UUID ${identity.UUID} (${identity.Source})`);
    DB.withDb(dbFile, (db) => {
      db.prepare(
        'INSERT INTO Clients (UUID, Hostname, OperatingSystem, Version, Slug, Timestamp) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(identity.UUID, os.hostname(), osName(), client.version, CLIENT_SLUG, Date.now());
      const info = db.prepare('INSERT OR REPLACE INTO ShowFileInfo (Key, Value) VALUES (?, ?)');
      info.run('CreatedWithVersion', server.version);
      info.run('SavedWithVersion', server.version);
      db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    });
    const showFile = path.join(sBox.home, 'E2E.ShowTrak');
    fs.copyFileSync(dbFile, showFile);
    fs.writeFileSync(
      path.join(sData, 'state.json'),
      JSON.stringify({ CurrentFilePath: showFile }, null, 2)
    );
    if (scripts) for (const [id, s] of Object.entries(SCRIPTS)) addScript(sData, id, s);

    // 3. The server for real.
    const main = launchServer(
      'server.log',
      devtools ? [`--remote-debugging-port=${devtools}`] : []
    );
    await waitListening(main, 'server port');

    // 4. The client, booting with a legacy adopted profile it migrates to its
    //    hardware UUID, keeping Adopted and Server.
    const cBox = A.makeSandbox(path.join(work, 'client'));
    stack.clientSandbox = cBox;
    const profile = path.join(A.clientDataDir(cBox), 'Profile', 'Profile.json');
    fs.mkdirSync(path.dirname(profile), { recursive: true });
    const seeded = {
      UUID: 'e2e-seed',
      Adopted: true,
      Server: { IP: '127.0.0.1', Port: port, AdoptionTime: Date.now() },
    };
    // With no readable firmware id and no physical MAC (a container), the client
    // derives a fresh random UUID on every boot, so a legacy profile would migrate
    // to one the server has never seen. A profile that already carries a random
    // identity keeps its cached UUID instead, so seed the one written above.
    if (identity.Source === 'random') {
      Object.assign(seeded, {
        UUID: identity.UUID,
        Identity: { Version: 1, Source: 'random', Witness: null, ResolvedAt: Date.now() },
      });
    }
    fs.writeFileSync(profile, JSON.stringify(seeded));
    stack.clientStartedAt = Date.now();
    launches.push(
      A.launchApp({ appDir: client.dir, sandbox: cBox, logFile: path.join(cBox.dir, 'client.log') })
    );
    return stack;
  } catch (err) {
    await stack.stop();
    throw err;
  }
}

// The client's row from the server's HTTP API, once it reports Online.
async function waitClientOnline(stack, timeoutMs = 90000) {
  return U.waitFor(
    async () => {
      const res = await fetch(`${stack.url}/API/Clients`);
      const body = await res.json();
      const me = body.Response.Data.find((c) => c.UUID === stack.uuid);
      return me && me.Online ? me : null;
    },
    { timeoutMs, intervalMs: 500, what: 'client online' }
  );
}

// Problems worth failing a run for. Each pattern must appear in a log line.
const SERVER_PROBLEMS =
  /Dropped invalid|Unadopt|unhandled|TypeError|ReferenceError|Cannot find module/i;
const CLIENT_PROBLEMS = /Unadopt|rejected|unhandled|TypeError|ReferenceError|Cannot find module/i;

function logProblems(stack) {
  return {
    server: A.scanLogs(stack.serverSandbox.dir, SERVER_PROBLEMS),
    client: A.scanLogs(stack.clientSandbox.dir, CLIENT_PROBLEMS),
  };
}

module.exports = { startStack, waitClientOnline, logProblems, CLIENT_SLUG, SCRIPTS };
