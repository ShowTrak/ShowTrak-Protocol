'use strict';
// The compatibility matrix: run interop.js for every server/client pairing that
// users can end up with during an upgrade.
//
//   node matrix.js --server <new server dir> --client <new client dir>
//                  [--old-server <dir>[,<dir>...]] [--old-client <dir>[,<dir>...]]
//
// Pairs: new server + new client, new server + each old client, each old server +
// new client. Each pair runs in its own process. Prints a table, appends it to
// $GITHUB_STEP_SUMMARY when set, and exits 1 if any pair failed.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const U = require('./lib/util');

const opts = U.parseArgs(process.argv.slice(2), {
  server: null,
  client: null,
  oldServer: '',
  oldClient: '',
  secs: 30,
});
if (!opts.server || !opts.client) {
  console.error(
    'usage: node matrix.js --server <dir> --client <dir> [--old-server <dirs>] [--old-client <dirs>]'
  );
  process.exit(2);
}
const list = (v) =>
  String(v || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
const version = (dir) =>
  JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;

const pairs = [{ label: 'new-server+new-client', server: opts.server, client: opts.client }];
for (const c of list(opts.oldClient))
  pairs.push({ label: `new-server+client-${version(c)}`, server: opts.server, client: c });
for (const s of list(opts.oldServer))
  pairs.push({ label: `server-${version(s)}+new-client`, server: s, client: opts.client });

function runPair(pair, out) {
  return new Promise((resolve) => {
    const args = [
      path.join(__dirname, 'interop.js'),
      '--server',
      pair.server,
      '--client',
      pair.client,
    ];
    args.push('--label', pair.label, '--secs', String(opts.secs), '--out', out);
    const child = spawn(process.execPath, args, { stdio: 'inherit' });
    child.on('exit', (code) => resolve(code));
  });
}

async function main() {
  const resultsDir = U.workDir('matrix');
  const rows = [];
  for (const pair of pairs) {
    U.log(`=== ${pair.label}`);
    const out = path.join(resultsDir, `${pair.label}.json`);
    const code = await runPair(pair, out);
    const r = U.readJson(out, {});
    const checks = r.checks || [];
    const failed = checks.filter((c) => !c.ok);
    rows.push({
      label: pair.label,
      server: r.server || version(pair.server),
      client: r.client || version(pair.client),
      ok: code === 0,
      passed: checks.filter((c) => c.ok && !c.skipped).length,
      skipped: checks.filter((c) => c.skipped).length,
      total: checks.length,
      failed: failed.map((c) => c.name),
      note: code === 2 ? 'run broke (see log)' : '',
    });
  }
  const lines = [
    '### ShowTrak interop matrix',
    '',
    '| Server | Client | Result | Checks | Failed |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map(
      (r) =>
        `| ${r.server} | ${r.client} | ${r.ok ? 'pass' : 'FAIL'} | ${r.passed}/${r.total - r.skipped}${r.skipped ? ` (+${r.skipped} skipped)` : ''} | ${[...r.failed, r.note].filter(Boolean).join('; ')} |`
    ),
    '',
  ];
  console.log(`\n${lines.join('\n')}`);
  if (process.env.GITHUB_STEP_SUMMARY)
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  fs.writeFileSync(path.join(resultsDir, 'summary.json'), JSON.stringify(rows, null, 2));
  return rows.every((r) => r.ok) ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(2);
  }
);
