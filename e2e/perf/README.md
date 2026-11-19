# ShowTrak perf harnesses (macOS)

Performance harnesses for ShowTrak Client and ShowTrak Server, run by hand on a Mac
(not in CI: CPU numbers from shared runners are too noisy to gate on). Each one takes
an **app dir** (anything with `dist/`, `package.json` and `node_modules`: a repo after
`npm run build`, or one made by `../prepare.js`). The
harness copies `dist/` + `package.json` into its own work dir first, so a rebuild of
the source dir mid-run does not change what is measured.

Requirements: macOS, node 22+ (uses global `fetch`/`WebSocket`), `python3`,
`/usr/bin/sqlite3`. socket.io / socket.io-client / electron are loaded from the repos
(`ShowTrakServer/node_modules`, `ShowTrakClient/node_modules`), found as siblings of
ShowTrak-Protocol or under `$SHOWTRAK_CODEBASE`; override with `--server-repo` /
`--client-repo` / `--electron <binary>`. Results and work dirs go to
`e2e/work/perf/` (or `$ST_E2E_WORK/perf/`), which is gitignored: they contain the
machine's hostname, addresses and paths, so never commit them.

## Run

```sh
cd ShowTrak-Protocol/e2e/perf

# Client (fake server + one real client), 3 runs x 90 s steady state
node client/run.js --app ../../../ShowTrakClient \
  --runs 3 --duration 90 --label new --out results-new-client.json

# same, against a server that never answers the capability probe (no deltas)
node client/run.js --app <dir> --runs 3 --duration 90 --old-server --no-config-window \
  --label new-oldserver --out results-new-client-oldserver.json

# Server (real server + N simulated adopted clients), N=100 and N=300
node server/run.js --app ../../../ShowTrakServer \
  --clients 100,300 --runs 3 --duration 90 --label new --out results-new-server.json

# Compare (medians); --all prints every numeric metric
node compare.js results-baseline-client.json results-new-client.json
node compare.js results-baseline-server.json results-new-server.json
node compare.js results-baseline-client-oldserver.json results-new-client-oldserver.json
```

For a baseline, build the release you are comparing against with
`node ../prepare.js --app server --ref v3.31.1 --dest /tmp/st-baseline-server` (same for
the client) and run the same commands with `--app` pointing at it. Each run writes `<out>.json`
(per-run metrics, medians under `median` / `scenarios[N].median`) and a
`<out>.txt` summary. Work dirs (sandboxes, app logs, spawn traces) are under
`work/`; add `--keep` to keep the Chromium profiles too.

Useful options — client: `--duration 180 --warmup 15 --runs 3 --old-server
--no-config-window --config-open-secs 15 --config-after-close-secs 30 --no-spawn-hook`.
Server: `--clients 100,300 --duration 180 --warmup 30 --ramp 15 --sdk 1 --webui 1
--groups 10 --app-change-prob 0.02 --client-version 3.28.2 --port <p>
--no-extra-monitors --no-window-flags`.

## Safety / sandboxing

- `ELECTRON_RUN_AS_NODE`, `ELECTRON_*`, `NODE_OPTIONS` are stripped from the env
  (some shells and tools set `ELECTRON_RUN_AS_NODE=1`).
- `HOME`, `APPDATA` point into `work/<run>/` and the app gets
  `--user-data-dir=work/<run>/userData`. HOME alone does **not** move Electron's
  userData on macOS (it would land in the real `~/Library/Application Support/ShowTrak
Server`), hence the flag; it also scopes the single-instance lock to the sandbox.
- Apps are always SIGKILLed (main first, then helpers), so no save/quit flow runs.
- Server: `APP_PORT` is always patched in the _copied_ `dist/Modules/Config/constants.js`
  to a free port (or `--port`), so real LAN clients configured for this Mac:3000 can
  never connect to (and be unadopted by) the sandboxed server. Bonjour still
  advertises the sandboxed server (real behaviour); clients that pin a server
  identity ignore it.
- Electron writes `~/Library/Preferences/com.github.Electron.plist` (the dev Electron
  bundle id, shared by every `electron .` run); nothing ShowTrak-named is touched.

## What is measured

CPU is **CPU-seconds** (ps `time`, user+sys, 10 ms resolution) per process over the
steady-state window, grouped by Electron process kind (main / renderer / gpu /
utility:network / utility:audio …). RSS is ps `rss` at the end of the window (helpers
share pages, so the sum over-counts; it is still comparable). Medians of the runs.

Child processes the main process spawns (lsappinfo, vm_stat, system_profiler, …) are
counted exactly by `lib/spawn-hook.js`, injected with `NODE_OPTIONS=--require`
(patches `ChildProcess.prototype.spawn` + the sync variants; logs pid/command/time).
A `ps` poller (150 ms) also records every descendant it sees, but misses most
short-lived ones. Their CPU: `lib/launch.py` runs Electron and `wait4()`s it, which on
macOS returns main + every descendant main reaped; minus main's own CPU at kill time =
CPU of spawned children over the whole life. `spawns.windowCpuEstimate` = that /
lifetime spawn count x spawns in the window; `cpuSeconds.totalInclChildren` adds it.

### Client (`client/run.js`)

- `client/fake-server.js`: socket.io server (from ShowTrakServer/node_modules), same
  ping timings as the real server, answers `GetServerCapabilities` (`{Deltas:true}`;
  never with `--old-server`), `GetScripts` (`[]`), `GetVariables`
  (`{Environment:{},Exported:[]}`), `GetLaunchConfig` (`{ScriptID:null,…}`). Records
  every event (name, time, JSON bytes) and wire bytes.
- Identity: a prime boot runs with a legacy identity-less adopted `Profile.json`
  pointing at the fake server; `ProfileManager.ReconcileIdentity` migrates it to this
  Mac's hardware UUID and keeps `Adopted`. That primed sandbox is copied for every run,
  so measured boots load an already-reconciled profile.
- Metrics: `startupMs` (launch → socket connection at the fake server),
  `firstHeartbeatMs`, `cpuSeconds.*`, `rssMB.*`, `spawns.*`, `traffic.perEvent.<name>`
  (events/s, B/s, avg size), `configWindow.*`.
- Config window: after the window, a second launch with the same user-data-dir
  triggers `second-instance` → config window. RSS is taken before, 15 s after it opens,
  and 30 s after closing it. The close is a real `BrowserWindow.close()` on the focused
  window, done through the main-process inspector, which is enabled only at that point
  (SIGUSR1 + `--inspect-port` in NODE_OPTIONS), so it is off while measuring. If
  macOS refuses to focus the window (screen locked, another app active), the harness
  makes `win.isFocused()` / `BrowserWindow.getFocusedWindow()` report that window for
  the duration of the `close()` call, so the app's close handler sees a user close of
  the focused window (`closeFocusEmulated: 1`).
  `rssMB.leftBehind` = after-close − before.

### Server (`server/run.js`)

- Adoption: the cheapest reliable route is to seed the sandboxed working DB. A prime
  boot creates `$HOME/Library/Application Support/ShowTrakServer/Storage/DB.sqlite`
  (schema, settings, SDK key); then per run `sqlite3` inserts `--groups` Groups and N
  `Clients` rows (`perf-client-001…`, Slug, GroupID, Timestamp — what
  `ClientManager.Create` writes), stamps `ShowFileInfo` with the app's version, copies
  the DB to `$HOME/Perf.ShowTrak` and writes `state.json` so the UI opens it as the
  current show (no Save-As / upgrade prompt). `load.unadopt` must be 0 and
  `serverLogDroppedInvalid` must be 0 (both checked every run).
- `server/loadgen.js` (child process) simulates N clients with socket.io-client,
  staggered over `--ramp`: the connect sequence and cadences of MainClient +
  ProcessMonitor + Network/Audio/Power/Temperature/Storage monitors (see the header
  of loadgen.js). Payloads (`server/payloads.js`) are synthetic Windows show PCs
  (35 apps, 2 displays, 6 USB devices, 3 NICs, 6 audio endpoints), deterministic per
  client. App list changes with p=0.02 per 3 s sample → `ApplicationDelta`; otherwise
  keepalives every 20 s and a full list every 60 s, exactly like the client.
- Observers: `--sdk` /sdk sockets (API key read from the DB), `--webui` /ui sockets
  (logged in via `auth:login`), and a probe socket on the client namespace.
- Lag: `lagMs.sdkCommand` = RTT of an unknown `/sdk command` ack, and
  `lagMs.clientNamespace` = RTT of `GetServerCapabilities`, once a second each; both
  are answered straight from the main-process event loop, so they track its lag.
- Chromium is started with `--disable-backgrounding-occluded-windows
--disable-renderer-backgrounding --disable-background-timer-throttling` (disable with
  `--no-window-flags`) so the dashboard renders as if visible even when covered.

## Caveats

- Machine is shared with other agents: CPU-seconds are robust to contention but not
  immune (frequency, caches). Expect ~5–15% run-to-run noise; compare medians.
- Client payloads are this Mac's real data (macOS samplers, interfaces, audio devices);
  absolute bytes and spawn mix differ on Windows clients.
- Spawned-children CPU in the window is an estimate (lifetime average per spawn).
- macOS App Nap may still throttle a backgrounded app's timers.

## Reference numbers

From the November 2026 performance pass (Server 3.31.1 -> 3.32, Client 3.28.2 -> 3.29,
an M-series MacBook Pro, medians of 3 x 90 s runs):

| Scenario                                            | Before         | After         |
| --------------------------------------------------- | -------------- | ------------- |
| Server, 300 simulated clients, CPU                  | 127% of a core | 12% of a core |
| Server, 300 simulated clients, RSS                  | 933 MB         | 760 MB        |
| Web UI push per browser, 300 clients                | 6.5 MB/s       | 82 KB/s       |
| Client idle on macOS, CPU-s per 90 s incl. children | 2.58           | 1.09          |

Use them as a sanity check, not a target: the absolute values depend on the machine.
