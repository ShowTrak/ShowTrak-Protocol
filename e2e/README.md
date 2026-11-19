# ShowTrak end-to-end checks

Checks that run **real built apps** against each other, across repos and across
versions. Unit tests in each app prove that app on its own. These prove the pieces
still work together, especially the rule that a new Server must keep working with
the older Clients, SDK, Companion modules and QLab definitions people already have
installed.

| Script             | What it checks                                                                                                                                                                                                                                                    | Needs                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `interop.js`       | One Server + one Client adopted by it: the client comes online, telemetry reaches an `/sdk` subscriber, scripts deploy, run and fail properly, the execution console streams output, nothing dies, and neither log shows rejections or crashes. Any version pair. | Server + Client           |
| `matrix.js`        | `interop.js` for every pairing an upgrade produces: new + new, new Server + older Clients, older Servers + new Client.                                                                                                                                            | Server + Client, x2       |
| `companion/run.js` | Released Companion modules and the new one against a live Server and Client: connection, variables, feedbacks, actions, executions, alerts, and that an API key never gets device-only pushes.                                                                    | Server + Client + modules |
| `qlab/check.js`    | Every OSC message the QLab definition can send (all menu combinations, every Monitor action) is accepted by the Server's routes, action catalogue and argument rules. Static, no Electron.                                                                        | Server (built) + NDD file |
| `perf/`            | CPU, memory and traffic harnesses for Server (simulated clients) and Client. Run by hand on a Mac; see [perf/README.md](perf/README.md).                                                                                                                          | macOS                     |

Each script exits 0 when every check passes, 1 when one fails and 2 when the run
itself broke, and prints one `PASS` / `FAIL` / `SKIP` line per check. Checks a
version cannot support (for example the execution console on a Server before 3.32)
are skipped, never failed.

## Setup

Node 22.13 or later (the harness uses the built-in `node:sqlite`, `fetch` and
`WebSocket`).

```sh
cd e2e
npm ci
```

The scripts take **built app dirs**: a checkout after `npm ci && npm run build`.
Use your working copies, or build any version with `prepare.js`:

```sh
node prepare.js --app server --ref main   --dest /tmp/st/server-main
node prepare.js --app client --ref latest --dest /tmp/st/client-latest   # newest release
node prepare.js --app companion --ref v1.1.0 --dest /tmp/st/module-v1.1.0
```

`--ref` takes a branch, tag, SHA or `latest` (the newest published release). A dest
that already holds that commit is reused.

## Running

```sh
# One pair
node interop.js --server ../../ShowTrakServer --client /tmp/st/client-latest

# The matrix
node matrix.js --server ../../ShowTrakServer --client ../../ShowTrakClient \
  --old-server /tmp/st/server-latest --old-client /tmp/st/client-latest

# Companion modules (old ones first, then the new one)
node companion/run.js --server ../../ShowTrakServer --client ../../ShowTrakClient \
  --module ../../companion-module-showtrak-server \
  --old-modules /tmp/st/module-v1.0.0,/tmp/st/module-v1.1.0

# QLab definition(s) against a server
node qlab/check.js --server ../../ShowTrakServer \
  --ndd ../../ShowTrak-QLabNetworkDeviceDescription/showtrak-server.json
```

On Linux the apps need a display: prefix the command with `xvfb-run -a`.

Run output (sandboxes, app logs, `result.json`) goes to `e2e/work/`, or
`$ST_E2E_WORK`. It is gitignored: it holds the machine's hostname, addresses and
paths.

## How a run is sandboxed

- The app's `dist/` is copied into the work dir first (with `node_modules` linked),
  so rebuilding the source mid-run changes nothing.
- The Server's compiled-in port is rewritten in that copy to a free one, so it never
  collides with, or adopts clients from, a real Server on 3000.
- `HOME`, `APPDATA` and Electron's `--user-data-dir` point into the work dir, so no
  real show, profile or setting is read or written.
- Adoption is seeded into the Server's database, keyed by the hardware UUID the
  Client derives (computed by the Client's own module), and the Client boots with
  an adopted profile pointing at the sandboxed Server. That works on every version
  without driving the UI.
- Everything is killed with SIGKILL (its whole process group) at the end, so no
  quit or save flow runs.

## CI

[`.github/workflows/e2e.yml`](../.github/workflows/e2e.yml) runs on Linux:

- nightly against `main` of every repo, paired with the latest releases;
- on every push that changes `e2e/`;
- by hand (Actions -> E2E -> Run workflow) with any refs;
- from the Server and Client release workflows (`workflow_call`), with the commit
  being released, so a release that breaks an older install is not published.

A failed run uploads the app logs and `result.json` files as an artifact.

## Adding checks

- Keep new checks version-aware: gate them on `U.atLeast(version, 'x.y.z')` and
  `checks.skip(...)` older versions, rather than failing them.
- The Companion scenario's `new` checks track `companion-module-showtrak-server`
  `main`. When the module gains a feature, add its checks to
  `companion/scenario.mjs` in the same change.
- Do not name files `*.test.js` or put them in a `test/` folder: the apps check this
  repo out as `shared/`, and ShowTrak Client's `node --test` would pick them up.
  Files here are also linted and format-checked by ShowTrak Server, which lints
  `shared/` with its own rules.
