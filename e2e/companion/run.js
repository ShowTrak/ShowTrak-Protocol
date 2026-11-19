'use strict';
// Companion module builds against a REAL sandboxed ShowTrak Server with a REAL
// ShowTrak Client: the released modules users have installed, and the new one.
//
//   node companion/run.js --server <built server dir> --client <built client dir>
//        --module <built module dir> [--old-modules <dir>[,<dir>...]]
//        [--new-variant new|new-old-server] [--label name]
//
// --new-variant new-old-server runs the new module's "refused cleanly" checks,
// for a server that predates its commands. Every module dir is a checkout of
// companion-module-showtrak-server after `yarn install && yarn build`.
// Exit code 0 when every check passes, 1 when one fails, 2 when the run broke.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const U = require('../lib/util');
const { startStack, waitClientOnline, CLIENT_SLUG } = require('../lib/stack');

const opts = U.parseArgs(process.argv.slice(2), {
  server: null,
  client: null,
  module: null,
  oldModules: '',
  newVariant: 'new',
  label: 'companion',
});
if (!opts.server || !opts.client || !opts.module) {
  console.error(
    'usage: node companion/run.js --server <dir> --client <dir> --module <dir> [--old-modules <dirs>]'
  );
  process.exit(2);
}

// Pushes the server must keep to paired devices: an integration API key never
// gets them.
const DEVICE_ONLY = [
  'SetFullAlertRuleList',
  'USBDeviceAdded',
  'USBDeviceRemoved',
  'SetOSCList',
  'PlaySound',
  'PlayCustomAudio',
  'AudioAssetsUpdated',
  'SetFullMonitoringActionFavouriteList',
  'AuditLogAppended',
  'UpdateSettings',
];

function runScenario(moduleDir, variant, env) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        '--import',
        pathToFileURL(path.join(__dirname, 'loader.mjs')).href,
        path.join(__dirname, 'scenario.mjs'),
      ].concat([moduleDir, variant]),
      { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 240000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      const line = out
        .trim()
        .split('\n')
        .filter((l) => l.startsWith('{'))
        .pop();
      try {
        resolve({ code, ...JSON.parse(line), stderr: err });
      } catch {
        resolve({
          code,
          checks: [
            { name: 'scenario produced a result', ok: false, detail: (err || out).slice(-3000) },
          ],
        });
      }
    });
  });
}

const moduleVersion = (dir) =>
  JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;

async function main() {
  const work = U.workDir(`companion-${opts.label}`);
  const devtools = await U.freePort();
  const deadPort = await U.freePort();
  const oldServer = opts.newVariant === 'new-old-server';
  const stack = await startStack({ server: opts.server, client: opts.client, work, devtools });
  const all = [];
  let raw;
  let dev;
  try {
    await waitClientOnline(stack);
    U.log('client online');

    // A raw API-key socket, recording every event it is sent from here on.
    const { io } = require('socket.io-client');
    raw = io(`${stack.url}/sdk`, {
      transports: ['websocket'],
      auth: { apiKey: stack.apiKey },
      forceNew: true,
    });
    const rawEvents = [];
    raw.onAny((name) => rawEvents.push(name));
    await U.waitFor(() => raw.connected, { timeoutMs: 10000, what: 'API-key socket' });

    // Seed through a paired device session (the management bridge).
    const SDK = await import('@showtrak/server-sdk');
    const paired = await SDK.ShowTrakControlClient.pair({
      host: '127.0.0.1',
      port: stack.port,
      deviceName: 'e2e',
      platform: 'test',
    });
    if (!paired.ok) throw new Error(`pairing failed: ${JSON.stringify(paired)}`);
    dev = new SDK.ShowTrakControlClient();
    let deviceAudit = 0;
    dev.on('auditLogAppended', () => deviceAudit++);
    dev.connect({ host: '127.0.0.1', port: stack.port, deviceToken: paired.deviceToken });
    await U.waitFor(() => dev.isConnected() && dev.getClient(CLIENT_SLUG), {
      timeoutMs: 10000,
      what: 'device session',
    });
    await dev.enterEditMode();
    await U.waitFor(() => dev.getMode() === 'EDIT', { timeoutMs: 5000, what: 'edit mode' });
    const must = async (label, promise) => {
      const r = await promise;
      if (!r.ok || (Array.isArray(r.result) && r.result[0]))
        throw new Error(`${label} failed: ${JSON.stringify(r)}`);
      return Array.isArray(r.result) ? r.result[1] : r.result;
    };
    await must('CreateGroup', dev.rpc('CreateGroup', ['E2E Group']));
    const group = await U.waitFor(() => dev.getGroups().find((g) => g.Title === 'E2E Group'), {
      what: 'group',
    });
    await must('UpdateClient', dev.rpc('UpdateClient', [stack.uuid, { GroupID: group.GroupID }]));
    const dummyDefaults = await must(
      'GenerateDummyClientDefaults',
      dev.rpc('GenerateDummyClientDefaults', [])
    );
    await must(
      'CreateDummyClient',
      dev.rpc('CreateDummyClient', [
        { ...dummyDefaults, DummyID: 'e2e-dummy', Nickname: 'E2E Dummy', Interval: 4000 },
      ])
    );
    await must(
      'CreateMonitoringTarget',
      dev.rpc('CreateMonitoringTarget', [
        {
          Nickname: 'E2E Projector',
          Interval: 300000,
          Checks: [{ Method: 'pjlink', Address: '127.0.0.1', Settings: { Port: deadPort } }],
        },
      ])
    );
    const kioskDefaults = await must(
      'GenerateFreeKioskTerminalDefaults',
      dev.rpc('GenerateFreeKioskTerminalDefaults', [])
    );
    await must(
      'CreateFreeKioskTerminal',
      dev.rpc('CreateFreeKioskTerminal', [
        {
          ...kioskDefaults,
          Nickname: 'E2E Kiosk',
          Address: '127.0.0.1',
          Port: deadPort,
          Interval: 300000,
        },
      ])
    );
    await must(
      'CreateAlertRule',
      dev.rpc('CreateAlertRule', [
        {
          Title: 'E2E online',
          Scope: { Workspace: true, Groups: [], Clients: [] },
          TriggerTypes: ['CLIENT_ONLINE'],
          Actions: [{ Type: 'showtrak-alert', Settings: {} }],
        },
      ])
    );
    const monitor = await U.waitFor(() => dev.getClientsByType('monitor')[0], { what: 'monitor' });
    const kiosk = await U.waitFor(() => dev.getClientsByType('freekiosk')[0], { what: 'kiosk' });
    await dev.enterShowMode();
    // CLIENT_ONLINE fires on an offline -> online transition, and a dummy's first
    // observation only sets its baseline. Heartbeat it once and let it lapse, so
    // the module's own heartbeat later is a real transition that raises an alert.
    // (A server before 3.34 has no dummy.heartbeat command.)
    if (!oldServer) {
      await dev.sendDummyHeartbeat('e2e-dummy');
      await U.waitFor(() => dev.getClient('e2e-dummy')?.Online === true, {
        timeoutMs: 5000,
        what: 'dummy online',
      });
      await U.waitFor(() => dev.getClient('e2e-dummy')?.Online === false, {
        timeoutMs: 30000,
        what: 'dummy lapsed',
      });
    }
    U.log(`seeded group=${group.Slug} monitor=${monitor.Slug} kiosk=${kiosk.Slug} dummy=e2e-dummy`);

    // Warm up: the client downloads the scripts on first contact.
    for (let i = 0; i < 8; i++) {
      await dev.clearSettledExecutions();
      await dev.runScriptOnClient(CLIENT_SLUG, 'Console_Check');
      const settled = await U.waitFor(
        () =>
          dev
            .getScriptExecutions()
            .find((e) => e.Script.ID === 'Console_Check' && e.Status !== 'Pending'),
        { timeoutMs: 20000, what: 'warm-up run' }
      );
      if (settled.Status === 'Completed') break;
      U.log(`warm-up ${i + 1}: ${settled.Status} (${settled.Error}); waiting for deployment`);
      await U.sleep(3000);
    }
    await dev.clearSettledExecutions();

    const env = {
      ST_PORT: String(stack.port),
      ST_APIKEY: stack.apiKey,
      ST_CLIENT_SLUG: CLIENT_SLUG,
      ST_GROUP: group.Slug,
      ST_MONITOR: monitor.Slug,
      ST_KIOSK: kiosk.Slug,
      ST_DUMMY: 'e2e-dummy',
      ST_SCRIPT_OK: 'Console_Check',
      ST_SCRIPT_FAIL: 'Fail_Check',
      ST_DEVTOOLS: String(devtools),
    };
    const variants = [
      ...String(opts.oldModules || '')
        .split(',')
        .filter(Boolean)
        .map((dir) => ({ dir, kind: 'old' })),
      { dir: opts.module, kind: opts.newVariant },
    ];
    for (const v of variants) {
      const name = `module ${moduleVersion(v.dir)} (${v.kind})`;
      U.log(`scenario ${name}`);
      const r = await runScenario(path.resolve(v.dir), v.kind, env);
      const checks = new U.Checks(name);
      for (const ch of r.checks || []) checks.add(ch.name, ch.ok, ch.detail);
      all.push(...checks.list);
      await dev.clearSettledExecutions();
    }

    // What the API-key socket was and was not sent.
    const wire = new U.Checks('wire');
    if (!oldServer) {
      const leaked = rawEvents.filter((e) => DEVICE_ONLY.includes(e));
      wire.add(
        'API-key socket got no device-only pushes',
        leaked.length === 0,
        [...new Set(leaked)].join(',')
      );
      wire.add('the device session did get audit pushes', deviceAudit > 0, String(deviceAudit));
      wire.add(
        'API-key socket got the executions snapshot on connect',
        rawEvents.includes('UpdateScriptExecutions'),
        rawEvents.slice(0, 12).join(',')
      );
    }
    all.push(...wire.list);
  } catch (err) {
    all.push({
      name: 'run completes',
      ok: false,
      detail: String(err && err.stack ? err.stack : err),
    });
    console.log(`  FAIL  run completes  -> ${err && err.message}`);
  } finally {
    if (raw) raw.close();
    if (dev) dev.disconnect();
    await stack.stop();
  }
  const failed = all.filter((c) => !c.ok);
  fs.writeFileSync(path.join(work, 'results.json'), JSON.stringify(all, null, 2));
  const line = `${all.length - failed.length}/${all.length} Companion checks passed (server ${stack.server.version})`;
  U.log(`${line}; details in ${work}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = failed
      .map((c) => `- FAIL ${c.name}: ${String(c.detail).slice(0, 200)}`)
      .join('\n');
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Companion module (${opts.label})\n\n${line}\n\n${rows}\n`
    );
  }
  return failed.length ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(2);
  }
);
