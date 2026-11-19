'use strict';
// Interop check with REAL apps: one ShowTrak Client adopted by one ShowTrak
// Server, both sandboxed. Any server/client version pair can be tested, which is
// how the matrix proves a new server still works with older clients and the
// other way round.
//
//   node interop.js --server <built server dir> --client <built client dir> [--label name] [--secs 30] [--out result.json]
//
// Exit code 0 when every check passes, 1 when one fails, 2 when the run broke.
// Results are written to <work>/result.json.
const fs = require('node:fs');
const path = require('node:path');
const U = require('./lib/util');
const { startStack, waitClientOnline, logProblems, CLIENT_SLUG } = require('./lib/stack');
const { rendererEval } = require('./lib/cdp');

const opts = U.parseArgs(process.argv.slice(2), {
  server: null,
  client: null,
  label: 'interop',
  secs: 30,
  out: null,
});
if (!opts.server || !opts.client) {
  console.error('usage: node interop.js --server <dir> --client <dir> [--label name] [--secs 30]');
  process.exit(2);
}

// Fields every supported client fills in on every platform.
const REQUIRED_TELEMETRY = [
  'Hostname',
  'IP',
  'OperatingSystem',
  'Vitals',
  'NetworkInterfaces',
  'StorageStatus',
];

async function main() {
  const work = U.workDir(`interop-${opts.label}`);
  const checks = new U.Checks(opts.label);
  const devtools = await U.freePort();
  const stack = await startStack({ server: opts.server, client: opts.client, work, devtools });
  const result = {
    label: opts.label,
    server: stack.server.version,
    client: stack.client.version,
    work,
  };
  let sdk;
  try {
    // An /sdk subscriber with the integration API key: what Companion and other
    // integrations see.
    const { io } = require('socket.io-client');
    sdk = io(`${stack.url}/sdk`, {
      transports: ['websocket'],
      forceNew: true,
      auth: { apiKey: stack.apiKey },
    });
    const seen = { updates: 0, last: null, events: {}, executions: null };
    sdk.onAny((event, payload) => {
      seen.events[event] = (seen.events[event] || 0) + 1;
      if (event === 'ClientUpdated' && payload && payload.UUID === stack.uuid) {
        seen.updates++;
        seen.last = payload;
      }
      if (event === 'UpdateScriptExecutions' && Array.isArray(payload)) seen.executions = payload;
    });
    const command = (name, args) =>
      new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ ok: false, detail: 'no ack within 10 s' }), 10000);
        sdk.emit('command', name, args, (res) => {
          clearTimeout(timer);
          resolve(res || { ok: false, detail: 'empty ack' });
        });
      });

    // --- Adoption and liveness -------------------------------------------------
    let online = null;
    try {
      online = await waitClientOnline(stack, 90000);
    } catch (err) {
      checks.add('client comes online', false, String(err.message));
      throw new Error('client never came online; nothing else can be checked', { cause: err });
    }
    result.secondsToOnline = (Date.now() - stack.clientStartedAt) / 1000;
    checks.add('client comes online', !!online, `${result.secondsToOnline}s`);
    checks.add('server reports the client version', online.Version === stack.client.version, {
      reported: online.Version,
      expected: stack.client.version,
    });

    // --- Telemetry reaches an /sdk subscriber ----------------------------------
    await U.sleep(Number(opts.secs) * 1000);
    const last = seen.last || {};
    result.sdkUpdates = seen.updates;
    checks.add(
      '/sdk receives ClientUpdated for the client',
      seen.updates >= 3,
      `${seen.updates} updates`
    );
    checks.add('/sdk sees the client online', last.Online === true, { Online: last.Online });
    const nonEmpty = (v) =>
      Array.isArray(v)
        ? v.length > 0
        : v && typeof v === 'object'
          ? Object.keys(v).length > 0
          : !!v;
    const missing = REQUIRED_TELEMETRY.filter((k) => !nonEmpty(last[k]));
    checks.add('telemetry fields are filled in', missing.length === 0, { missing });
    result.telemetry = Object.fromEntries(
      Object.keys(last)
        .sort()
        .map((k) => [k, nonEmpty(last[k])])
    );

    // --- Scripts: deploy, run, fail, console output ------------------------------
    const executionsOnSdk = U.atLeast(stack.server.version, '3.34.0');
    if (!executionsOnSdk) {
      checks.skip('script runs', `server ${stack.server.version} does not push executions to /sdk`);
    } else {
      const runAndSettle = async (scriptSlug) => {
        const ack = await command('script.client', { slug: CLIENT_SLUG, scriptSlug });
        if (!ack.ok) return { ack };
        const started = Date.now();
        const exec = await U.poll(
          () =>
            (seen.executions || []).find(
              (e) =>
                e.Script &&
                e.Script.ID === scriptSlug &&
                e.Status !== 'Pending' &&
                e.Timer.Start >= started - 2000
            ),
          30000,
          200
        );
        return { ack, exec };
      };
      // The first run can race the client downloading the scripts.
      let ok = null;
      for (let i = 0; i < 8; i++) {
        ok = await runAndSettle('Console_Check');
        if (!ok.ack.ok || (ok.exec && ok.exec.Status === 'Completed')) break;
        U.log(
          `warm-up ${i + 1}: ${ok.exec ? `${ok.exec.Status} (${ok.exec.Error})` : 'no result'}; waiting for deployment`
        );
        await U.sleep(3000);
      }
      checks.add('script.client command accepted', ok.ack.ok, ok.ack);
      checks.add(
        'script runs to Completed on the client',
        ok.exec && ok.exec.Status === 'Completed',
        ok.exec || 'no result'
      );
      const fail = await runAndSettle('Fail_Check');
      checks.add(
        'failing script reports Failed',
        fail.exec && fail.exec.Status === 'Failed',
        fail.exec || fail.ack
      );

      // The execution console (server 3.32+) streams output from clients that
      // advertise it (3.29+); read it from the server's own renderer.
      const hasConsole = await rendererEval(
        devtools,
        "typeof window.API === 'object' && typeof window.API.GetScriptExecutionOutput === 'function'"
      ).catch(() => false);
      if (!hasConsole) {
        checks.skip(
          'execution console output',
          `server ${stack.server.version} has no execution console`
        );
      } else if (ok.exec) {
        const reply = await rendererEval(
          devtools,
          `window.API.GetScriptExecutionOutput(${JSON.stringify(ok.exec.RequestID)}, 0)`
        ).catch((err) => [String(err.message), null]);
        const [err, view] = Array.isArray(reply) ? reply : ['unexpected reply', null];
        const text =
          view && Array.isArray(view.Entries)
            ? view.Entries.map((e) => `${e.Kind}: ${e.Text}`).join('\n')
            : '';
        result.consoleOutput = text;
        if (U.atLeast(stack.client.version, '3.29.0')) {
          checks.add(
            'execution console has the streamed stdout',
            !err && /step 3 of 3/.test(text),
            err || text
          );
          checks.add(
            'execution console has the stderr line',
            /example stderr line/.test(text),
            text
          );
        } else {
          checks.add('execution console answers for an older client', !err, err || 'ok');
        }
      }
    }

    // --- Nothing went wrong along the way ----------------------------------------
    const died = stack.launches
      .filter((l) => l.exited && !l.killed)
      .map((l) => path.basename(l.logFile));
    checks.add('server and client are still running', died.length === 0, { exited: died });
    const problems = logProblems(stack);
    result.logProblems = problems;
    checks.add(
      'server log has no rejections or crashes',
      problems.server.length === 0,
      problems.server
    );
    checks.add(
      'client log has no rejections or crashes',
      problems.client.length === 0,
      problems.client
    );
    result.sdkEvents = seen.events;
  } catch (err) {
    checks.add('run completes', false, err && err.message ? err.message : String(err));
    result.logProblems = logProblems(stack);
  } finally {
    if (sdk) sdk.close();
    await stack.stop();
  }
  result.checks = checks.list;
  result.passed = checks.failed.length === 0;
  fs.writeFileSync(path.join(work, 'result.json'), JSON.stringify(result, null, 2));
  if (opts.out) fs.writeFileSync(opts.out, JSON.stringify(result, null, 2));
  U.log(
    `${opts.label}: ${checks.summary()} (server ${result.server}, client ${result.client}); details in ${work}`
  );
  return result.passed ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`FAILED ${opts.label}:`, err && err.stack ? err.stack : err);
    process.exit(2);
  }
);
