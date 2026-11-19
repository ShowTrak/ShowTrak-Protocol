'use strict';
// Fetch and build one ShowTrak app at a given ref, ready for the e2e scripts.
//
//   node prepare.js --app server|client|companion --ref <tag|branch|sha|latest> --dest <dir>
//
// `latest` is the newest published (non-pre-release) GitHub release: what users
// have installed right now. The resolved version is printed on stdout (last line)
// so CI can use it in names. A dest that already holds a build of the same commit
// is reused.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const U = require('./lib/util');

const APPS = {
  server: {
    repo: 'ShowTrak/ShowTrakServer',
    install: ['npm', ['ci']],
    build: ['npm', ['run', 'build']],
  },
  client: {
    repo: 'ShowTrak/ShowTrakClient',
    install: ['npm', ['ci']],
    build: ['npm', ['run', 'build']],
  },
  companion: {
    repo: 'bitfocus/companion-module-showtrak-server',
    install: ['corepack', ['yarn', 'install', '--immutable']],
    build: ['corepack', ['yarn', 'build']],
  },
};

function run(cmd, args, cwd, env = {}) {
  const res = spawnSync(cmd, args, {
    cwd,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, HUSKY: '0', CI: process.env.CI || '1', ...env },
    shell: process.platform === 'win32',
  });
  if (res.status !== 0)
    throw new Error(`${cmd} ${args.join(' ')} failed in ${cwd} (exit ${res.status})`);
}

function git(args, cwd) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`);
  return res.stdout.trim();
}

async function latestRelease(repo) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'showtrak-e2e' };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers });
  if (!res.ok) throw new Error(`GitHub releases/latest for ${repo}: HTTP ${res.status}`);
  return (await res.json()).tag_name;
}

async function main() {
  const opts = U.parseArgs(process.argv.slice(2), { app: null, ref: null, dest: null });
  const app = APPS[opts.app];
  if (!app || !opts.ref || !opts.dest) {
    console.error(
      'usage: node prepare.js --app server|client|companion --ref <tag|branch|sha|latest> --dest <dir>'
    );
    process.exit(2);
  }
  const ref = opts.ref === 'latest' ? await latestRelease(app.repo) : String(opts.ref);
  const dest = path.resolve(opts.dest);
  fs.mkdirSync(dest, { recursive: true });
  if (!fs.existsSync(path.join(dest, '.git'))) {
    git(['init', '-q'], dest);
    git(['remote', 'add', 'origin', `https://github.com/${app.repo}.git`], dest);
  }
  U.log(`${app.repo}@${ref} -> ${dest}`);
  git(['fetch', '-q', '--depth', '1', '--tags', 'origin', ref], dest);
  const sha = git(['rev-parse', 'FETCH_HEAD'], dest);
  const marker = path.join(dest, '.e2e-built');
  if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8').trim() === sha) {
    U.log(`already built at ${sha.slice(0, 10)}`);
  } else {
    git(['checkout', '-q', '--force', sha], dest);
    git(['submodule', 'update', '-q', '--init', '--recursive', '--depth', '1'], dest);
    run(app.install[0], app.install[1], dest);
    run(app.build[0], app.build[1], dest);
    fs.writeFileSync(marker, sha);
  }
  const version = JSON.parse(fs.readFileSync(path.join(dest, 'package.json'), 'utf8')).version;
  U.log(`${opts.app} ${version} (${sha.slice(0, 10)}) ready in ${dest}`);
  console.log(version);
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
