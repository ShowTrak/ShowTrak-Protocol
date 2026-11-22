// `npm test`: run an app's suite with no ShowTrak application data (ShowTrak
// Server and ShowTrak Timers).
//
// The apps' managers open their sqlite database on first use (several of the
// Server's when their module is first loaded). Run against a developer's real
// app-data directory, a test that forgot to stub or inject such a manager
// passes in milliseconds against (and migrates) the real working database. CI
// has no such database, and the same test hangs or sees something else, which
// is how a green local run has more than once shipped a red pipeline.
//
// Pointing HOME (and the Windows/XDG equivalents) at an empty directory moves
// the app-data path somewhere that does not exist, so every run (local, CI and
// coverage) sees the same empty machine and never touches real show data.
//
// Extra arguments are passed through to `node --test`, so a single file runs as
// `npm test -- test/db.test.js`.
//
// The app's scripts/run-isolated-tests.js:
//   require('../shared/scripts/run-isolated-tests').main();
//
// Not named test-*.js: that matches node --test's default file pattern, so the
// suite would run this script as a test file of its own (spawning a recursive
// run that node skips with a warning).
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** The environment the suite runs in: this one, with every home folder in `sandbox`. */
function isolatedEnv(sandbox, env = process.env) {
  return {
    ...env,
    HOME: sandbox,
    USERPROFILE: sandbox,
    APPDATA: path.join(sandbox, 'AppData', 'Roaming'),
    XDG_DATA_HOME: path.join(sandbox, '.local', 'share'),
  };
}

/** The `node` arguments: one file at a time, generous per-file timeout, then `args`. */
function testArgs(args) {
  return [
    '--test',
    '--test-concurrency=1',
    // Per file. Generous for slow Windows runners (the Server's MX-8A suite
    // waits out the unit's 1 s connection release between sessions and runs
    // past 30 s there); a hung test still fails.
    '--test-timeout=60000',
    '--test-force-exit',
    ...args,
  ];
}

/**
 * Run `node --test` in the current folder (the app's root, under npm) in a
 * fresh sandbox, then delete it. Sets process.exitCode to the suite's.
 */
function main({ args = process.argv.slice(2) } = {}) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'showtrak-isolated-'));
  try {
    const result = spawnSync(process.execPath, testArgs(args), {
      stdio: 'inherit',
      env: isolatedEnv(sandbox),
    });
    process.exitCode = result.status == null ? 1 : result.status;
  } finally {
    // Retries: on Windows a just-exited child can hold a file handle briefly.
    fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

module.exports = { main, isolatedEnv, testArgs };
