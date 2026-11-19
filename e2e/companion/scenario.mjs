// Drive one build of companion-module-showtrak-server against a live server.
//
//   node --import ./loader.mjs scenario.mjs <moduleDir> <old|new>
//
// Reads ST_* from the environment (see run.js). Prints one JSON line:
// { checks: [{ name, ok, detail }], logs, uncaught }.
import path from 'node:path';

const [moduleDir, variant] = process.argv.slice(2);
const E = process.env;
const port = Number(E.ST_PORT);
const checks = [];
const uncaught = [];
process.on('uncaughtException', (e) => uncaught.push(String(e && e.stack ? e.stack : e)));
process.on('unhandledRejection', (e) => uncaught.push(String(e && e.stack ? e.stack : e)));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeoutMs = 15000, intervalMs = 100) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    let v;
    try {
      v = await fn();
    } catch {
      v = null;
    }
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(intervalMs);
  }
}
function check(name, ok, detail = '') {
  checks.push({
    name,
    ok: !!ok,
    detail: typeof detail === 'string' ? detail : JSON.stringify(detail),
  });
}

const { default: ModuleInstance } = await import(path.join(moduleDir, 'dist', 'main.js'));
const m = new ModuleInstance({});
await m.init({ host: '127.0.0.1', port, telemetryVariables: true }, true, { apiKey: E.ST_APIKEY });

const v = (id) => m.__variables[id];
const act = async (id, options) => {
  const def = m.__actions[id];
  if (!def) throw new Error(`no action ${id}`);
  const before = m.__logs.length;
  await def.callback({ id: `a-${id}`, controlId: 'bank:1', actionId: id, options }, {});
  // Commands resolve on the ack; the warn (if any) is logged right after.
  await sleep(50);
  return m.__logs
    .slice(before)
    .filter(([l]) => l === 'warn')
    .map(([, msg]) => msg);
};
const fb = (id, options = {}) => {
  const def = m.__feedbacks[id];
  if (!def) throw new Error(`no feedback ${id}`);
  return def.callback({ id: `f-${id}`, controlId: 'bank:1', feedbackId: id, options }, {});
};
const anyUnknown = (warns) => warns.some((w) => /Unknown command/.test(w));

const okStatus = await waitFor(() => m.__status.some(([s]) => s === 'ok'), 15000);
check('connects (status ok)', okStatus, m.__status);
const client = E.ST_CLIENT_SLUG;
const online = await waitFor(() => v(`client_${client}_status`) === 'ONLINE', 15000);
check('client status variable reads ONLINE', online, v(`client_${client}_status`));
check('clients_total counts the client', Number(v('clients_total')) >= 1, v('clients_total'));

const tile = fb('client_status', { slug: client });
check(
  'client tile feedback paints a colour and label',
  tile && typeof tile.bgcolor === 'number' && tile.text,
  tile
);

// Mode and alerts round trips: shipped in every release.
let w = await act('mode_toggle', {});
const edit = await waitFor(() => v('mode') === 'EDIT', 5000);
check('mode_toggle enters EDIT', edit && !w.length, { mode: v('mode'), w });
w = await act('mode_show', {});
check('mode_show returns to SHOW', (await waitFor(() => v('mode') === 'SHOW', 5000)) && !w.length, {
  mode: v('mode'),
  w,
});
const alertsBefore = v('alerts_enabled');
w = await act('alerts_toggle', {});
const flipped = await waitFor(() => v('alerts_enabled') !== alertsBefore, 5000);
w.push(...(await act('alerts_toggle', {})));
check(
  'alerts_toggle flips and flips back',
  flipped && (await waitFor(() => v('alerts_enabled') === alertsBefore, 5000)) && !w.length,
  w
);

// Script run (command bridge) and modal commands.
w = await act('script_client', { slug: client, scriptSlug: E.ST_SCRIPT_OK, confirm: false });
check('script_client runs a script', !w.length, w);
w = await act('modal_open_client', { slug: client });
w.push(...(await act('modal_close_all', {})));
check('modal open/close commands accepted', !w.length, w);
// A FreeKiosk terminal opens its own view (was routed to the client view before 3.34).
w = await act('modal_open_client', { slug: E.ST_KIOSK });
check('modal_open_client accepts a FreeKiosk terminal', !w.length, w);
await act('modal_close_all', {});

if (variant === 'new') {
  // --- Telemetry variables -------------------------------------------------
  const cpu = await waitFor(() => typeof v(`client_${client}_cpu`) === 'number', 20000);
  check('telemetry: CPU is a number', cpu, v(`client_${client}_cpu`));
  check(
    'telemetry: RAM is a number',
    typeof v(`client_${client}_ram`) === 'number',
    v(`client_${client}_ram`)
  );
  check('telemetry: IP is set', !!v(`client_${client}_ip`), v(`client_${client}_ip`));
  check(
    'telemetry: no telemetry vars for a monitor',
    !(`client_${E.ST_MONITOR}_cpu` in m.__variableDefs),
    Object.keys(m.__variableDefs).filter((k) => k.startsWith(`client_${E.ST_MONITOR}_`))
  );

  // --- Coalescing: re-declaration only when the entity set changes ----------
  const sets0 = m.__variableSets;
  const calls0 = m.__variableValueCalls;
  await sleep(6000);
  check('variables are not re-declared on heartbeats', m.__variableSets === sets0, {
    before: sets0,
    after: m.__variableSets,
  });
  check('values still flow on heartbeats', m.__variableValueCalls > calls0, {
    before: calls0,
    after: m.__variableValueCalls,
  });

  check(
    'client_status_is ONLINE',
    fb('client_status_is', { slug: client, status: 'ONLINE' }) === true
  );
  check(
    'client_status_is OFFLINE is false',
    fb('client_status_is', { slug: client, status: 'OFFLINE' }) === false
  );
  check(
    'client_status_is unknown slug is false',
    fb('client_status_is', { slug: 'nope', status: 'OFFLINE' }) === false
  );

  // --- Identify --------------------------------------------------------------
  w = await act('identify_client', { slug: client, state: 'toggle' });
  const idOn = await waitFor(() => fb('client_identifying', { slug: client }) === true, 8000);
  check('identify toggle starts identifying', idOn && !w.length, w);
  w = await act('identify_client', { slug: client, state: 'toggle' });
  const idOff = await waitFor(() => fb('client_identifying', { slug: client }) === false, 8000);
  check('identify toggle stops identifying', idOff && !w.length, w);

  // --- Script running / failed / retry / clear -------------------------------
  await act('executions_clear', {});
  w = await act('script_client', { slug: client, scriptSlug: E.ST_SCRIPT_OK, confirm: false });
  const running = await waitFor(
    () => fb('script_running', { scope: 'client', slug: client, actionSlug: E.ST_SCRIPT_OK }),
    8000,
    50
  );
  check('script_running lights while the script runs', running && !w.length, w);
  check(
    'script_running for another script stays dark',
    fb('script_running', { scope: 'client', slug: client, actionSlug: E.ST_SCRIPT_FAIL }) === false
  );
  check(
    'executions_running counts it',
    Number(v('executions_running')) >= 1 ||
      !!(await waitFor(() => Number(v('executions_running')) >= 1, 2000, 20)),
    v('executions_running')
  );
  const done = await waitFor(
    () => !fb('script_running', { scope: 'all', slug: '', actionSlug: '' }),
    20000
  );
  check('script_running goes dark when it finishes', done);
  check(
    'executions_completed counts it',
    await waitFor(() => Number(v('executions_completed')) >= 1, 2000),
    v('executions_completed')
  );

  w = await act('script_group', { slug: E.ST_GROUP, scriptSlug: E.ST_SCRIPT_FAIL, confirm: false });
  const failed = await waitFor(
    () => fb('script_failed', { scope: 'group', slug: E.ST_GROUP, actionSlug: '' }),
    20000
  );
  check('script_failed lights for the group', failed && !w.length, w);
  check(
    'executions_failed / retryable count it',
    await waitFor(
      () => Number(v('executions_failed')) >= 1 && Number(v('executions_retryable')) >= 1,
      2000
    ),
    { failed: v('executions_failed'), retryable: v('executions_retryable') }
  );
  w = await act('executions_retry_failed', { confirm: false });
  check('executions_retry_failed accepted', !w.length, w);
  const retriedRunning = await waitFor(
    () => fb('script_running', { scope: 'all', slug: '', actionSlug: E.ST_SCRIPT_FAIL }),
    8000,
    50
  );
  check('the retry runs the failed script again', retriedRunning);
  await waitFor(
    () => fb('script_failed', { scope: 'all', slug: '', actionSlug: E.ST_SCRIPT_FAIL }),
    20000
  );
  w = await act('executions_clear', {});
  const cleared = await waitFor(
    () =>
      v('executions_failed') === '0' &&
      !fb('script_failed', { scope: 'all', slug: '', actionSlug: '' }),
    8000
  );
  check('executions_clear empties the failures', cleared && !w.length, {
    failed: v('executions_failed'),
    w,
  });

  // --- The FreeKiosk view modal (checked in the desktop renderer) -------------
  if (E.ST_DEVTOOLS) {
    await act('modal_close_all', {});
    await sleep(600);
    w = await act('modal_open_client', { slug: E.ST_KIOSK });
    const opened = await waitFor(
      () =>
        rendererEval(
          Number(E.ST_DEVTOOLS),
          "(() => { const m = document.getElementById('SHOWTRAK_CLIENT_INFO'); return !!m && m.classList.contains('show') && /E2E Kiosk/.test(m.textContent || ''); })()"
        ),
      8000,
      300
    );
    check('modal_open_client opens the FreeKiosk terminal view', opened && !w.length, w);
    await act('modal_close_all', {});
    await sleep(600);
  }

  // --- View layout (checked in the desktop renderer) -------------------------
  w = await act('view_set', { view: 'list' });
  check('view_set list accepted', !w.length, w);
  await sleep(800);
  const viewNow = E.ST_DEVTOOLS
    ? await rendererEval(Number(E.ST_DEVTOOLS), "localStorage.getItem('showtrak.ui.viewMode')")
    : 'skipped';
  check('the desktop switched to the list view', viewNow === 'list', viewNow);
  w = await act('view_toggle_compact', {});
  await sleep(800);
  const viewToggled = E.ST_DEVTOOLS
    ? await rendererEval(Number(E.ST_DEVTOOLS), "localStorage.getItem('showtrak.ui.viewMode')")
    : 'skipped';
  check('view_toggle_compact switched to compact', viewToggled === 'compact' && !w.length, {
    viewToggled,
    w,
  });
  await act('view_set', { view: 'grid' });

  // --- Dummy heartbeat and the alert it raises -------------------------------
  w = await act('dummy_heartbeat', { slug: E.ST_DUMMY });
  check('dummy_heartbeat accepted', !w.length, w);
  check(
    'the dummy comes online',
    await waitFor(() => v(`client_${E.ST_DUMMY}_status`) === 'ONLINE', 3000),
    v(`client_${E.ST_DUMMY}_status`)
  );
  const alerted = await waitFor(() => fb('alert_raised', { seconds: 30, severity: 'any' }), 10000);
  check('alert_raised lights when a rule raises an alert', alerted, {
    title: v('last_alert_title'),
  });
  await waitFor(() => !!v('last_alert_title'), 2000);
  check(
    'last_alert_* variables are set',
    !!v('last_alert_title') && /^\d\d:\d\d:\d\d$/.test(v('last_alert_time') || ''),
    { title: v('last_alert_title'), time: v('last_alert_time'), sev: v('last_alert_severity') }
  );
  check(
    'alert_raised error-only filter respects severity',
    fb('alert_raised', { seconds: 30, severity: 'success' }) ===
      (v('last_alert_severity') === 'success')
  );
  w = await act('dummy_heartbeat', { slug: 'no-such-dummy' });
  check(
    'dummy_heartbeat for an unknown dummy is refused',
    w.some((x) => /Unknown Dummy/.test(x)),
    w
  );

  // --- Monitor actions --------------------------------------------------------
  w = await act('monitor_action', {
    slug: E.ST_MONITOR,
    method: 'pjlink',
    actionId: 'power.on',
    value: '',
    confirm: false,
  });
  check(
    'monitor_action reaches the device (no projector here, so it fails there)',
    w.length === 1 && /Power On on/.test(w[0]) && !anyUnknown(w),
    w
  );
  w = await act('monitor_action', {
    slug: E.ST_MONITOR,
    method: 'pjlink',
    actionId: 'no.such',
    value: '',
    confirm: false,
  });
  check(
    'monitor_action names an unknown action',
    w.some((x) => /Unknown action/.test(x)),
    w
  );

  // --- FreeKiosk ----------------------------------------------------------------
  w = await act('freekiosk_terminal', {
    slug: E.ST_KIOSK,
    commandId: 'brightness',
    value: '150',
    confirm: false,
  });
  check(
    'freekiosk value is validated server-side',
    w.some((x) => /between 0 and 100/.test(x)),
    w
  );
  w = await act('freekiosk_terminal', {
    slug: E.ST_KIOSK,
    commandId: 'screen.on',
    value: '',
    confirm: false,
  });
  check(
    'freekiosk_terminal reaches the terminal (none listening, so it fails there)',
    w.length === 1 && /Screen On on/.test(w[0]),
    w
  );
  w = await act('freekiosk_all', { commandId: 'wake', value: '', confirm: false });
  check('freekiosk_all reaches every terminal', w.length === 1 && /Wake Screen on/.test(w[0]), w);
  w = await act('freekiosk_group', {
    slug: 'no-such-group',
    commandId: 'wake',
    value: '',
    confirm: false,
  });
  check(
    'freekiosk_group refuses an unknown group',
    w.some((x) => /Invalid Group/.test(x)),
    w
  );
  w = await act('freekiosk_terminal', {
    slug: E.ST_KIOSK,
    commandId: 'js',
    value: '',
    confirm: false,
  });
  check(
    'freekiosk refuses a command off the allowlist',
    w.some((x) => /Unknown FreeKiosk command/.test(x)),
    w
  );

  // --- Confirm gate on a new action ------------------------------------------
  const logsBefore = m.__logs.length;
  await m.__actions.executions_retry_failed.callback(
    { id: 'x', controlId: 'bank:2', options: { confirm: true } },
    {}
  );
  check(
    'confirm arms instead of running',
    m.isConfirmPending('bank:2') && m.__logs.length === logsBefore
  );

  // --- Adoption and presets ---------------------------------------------------
  check(
    'pending_adoption is dark with nothing waiting',
    fb('pending_adoption') === false && v('pending_adoption_count') === '0',
    v('pending_adoption_count')
  );
  const presetIds = Object.keys(m.__presets?.presets || {});
  const want = [
    'executions_retry_failed',
    'view_list',
    'identify_client',
    'freekiosk_screen_on',
    'monitor_action',
    'dummy_heartbeat',
    'exec_status_group',
    'tile_client',
    'wol_client_confirm',
  ];
  check(
    'presets include the new and the existing ones',
    want.every((id) => presetIds.includes(id)),
    want.filter((id) => !presetIds.includes(id))
  );
} else if (variant === 'new-old-server') {
  // A new module against a server that predates the new commands: refused
  // cleanly, nothing else disturbed.
  for (const [id, options] of [
    ['view_set', { view: 'list' }],
    ['dummy_heartbeat', { slug: E.ST_DUMMY }],
    ['executions_retry_failed', { confirm: false }],
    ['freekiosk_all', { commandId: 'wake', value: '', confirm: false }],
    [
      'monitor_action',
      { slug: E.ST_MONITOR, method: 'pjlink', actionId: 'power.on', value: '', confirm: false },
    ],
  ]) {
    const warns = await act(id, options);
    check(`${id} is refused as an unknown command`, anyUnknown(warns), warns);
  }
  const cpu = await waitFor(() => typeof v(`client_${client}_cpu`) === 'number', 20000);
  check('telemetry still works', cpu, v(`client_${client}_cpu`));
  w = await act('identify_client', { slug: client, state: 'on' });
  check('identify works (3.19+)', !w.length, w);
  await act('identify_client', { slug: client, state: 'off' });
}

await sleep(300);
check('no uncaught errors', uncaught.length === 0, uncaught);
await m.destroy();
const unexpected = m.__logs.filter(([l]) => l === 'error');
check('no error logs', unexpected.length === 0, unexpected);
console.log(JSON.stringify({ variant, moduleDir, checks, logs: m.__logs }));
process.exit(0);

async function rendererEval(devtoolsPort, expression) {
  const targets = await (await fetch(`http://127.0.0.1:${devtoolsPort}/json/list`)).json();
  const page =
    targets.find((t) => t.type === 'page' && /index\.html/.test(t.url)) ||
    targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
  const result = await new Promise((resolve) => {
    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      if (data.id === 1) resolve(data.result?.result?.value);
    };
    ws.send(
      JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true },
      })
    );
  });
  ws.close();
  return result;
}
