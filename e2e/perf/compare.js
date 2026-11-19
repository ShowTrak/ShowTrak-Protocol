#!/usr/bin/env node
'use strict';
// Compare two harness result files (client or server) by their medians.
//   node compare.js results-baseline-client.json results-new-client.json
//   node compare.js results-baseline-server.json results-new-server.json [--all]
// Prints every numeric metric present in either file with old, new, delta and
// % change. Without --all, only headline metrics are shown.
const fs = require('fs');

const args = process.argv.slice(2);
const all = args.includes('--all');
const [aFile, bFile] = args.filter((x) => !x.startsWith('--'));
if (!aFile || !bFile) {
  console.error('usage: node compare.js <baseline.json> <new.json> [--all]');
  process.exit(2);
}
const A = JSON.parse(fs.readFileSync(aFile, 'utf8'));
const B = JSON.parse(fs.readFileSync(bFile, 'utf8'));
if (A.harness !== B.harness)
  console.warn(`warning: comparing a ${A.harness} result with a ${B.harness} result`);

function flatten(obj, prefix = '', out = {}) {
  if (obj === null || obj === undefined) return out;
  if (typeof obj === 'number') {
    out[prefix] = obj;
    return out;
  }
  if (typeof obj !== 'object' || Array.isArray(obj)) return out;
  for (const [k, v] of Object.entries(obj)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  return out;
}

const HEADLINE = [
  /^startupMs$/,
  /^listenMs$/,
  /^cpuSeconds\./,
  /^cpuPctOneCore$/,
  /^rssMB\./,
  /^rssMBAvgTotal$/,
  /^spawns\.(hookCount|hookPerMinute|windowCpuEstimate)$/,
  /^traffic\.(eventsPerSec|bytesPerSec)$/,
  /^traffic\.perEvent\.[^.]+\.bytesPerSec$/,
  /^configWindow\.rssMB\./,
  /^configWindow\.renderers\./,
  /^lagMs\.[^.]+\.(p50|p95|p99|max)$/,
  /^(sdk|webui)\.(eventsPerSec|bytesPerSec)$/,
  /^(sdk|webui)\.perChannel\.[^.]+\.bytesPerSec$/,
  /^load\.(connected|sentEventsPerSec|unadopt|disconnects)$/,
  /^serverLogDroppedInvalid$/,
];

function table(ma, mb, title) {
  const fa = flatten(ma);
  const fb = flatten(mb);
  const keys = Array.from(new Set([...Object.keys(fa), ...Object.keys(fb)])).filter(
    (k) => all || HEADLINE.some((re) => re.test(k))
  );
  const rows = keys.map((k) => {
    const a = fa[k];
    const b = fb[k];
    const d = a !== undefined && b !== undefined ? b - a : null;
    const pct = d !== null && a ? (d / Math.abs(a)) * 100 : null;
    return [k, a, b, d, pct];
  });
  const fmt = (x) =>
    x === undefined || x === null ? '-' : Number.isInteger(x) ? String(x) : x.toFixed(2);
  const w = Math.max(10, ...rows.map((r) => r[0].length));
  console.log(`\n== ${title}`);
  console.log(
    `${'metric'.padEnd(w)}  ${'baseline'.padStart(12)}  ${'new'.padStart(12)}  ${'delta'.padStart(12)}  ${'%'.padStart(8)}`
  );
  for (const [k, a, b, d, pct] of rows) {
    const p = pct === null ? '-' : `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
    console.log(
      `${k.padEnd(w)}  ${fmt(a).padStart(12)}  ${fmt(b).padStart(12)}  ${fmt(d).padStart(12)}  ${p.padStart(8)}`
    );
  }
}

console.log(`baseline: ${aFile} (${A.label} v${A.version}, ${A.createdAt})`);
console.log(`new:      ${bFile} (${B.label} v${B.version}, ${B.createdAt})`);
if (A.harness === 'server') {
  const ns = Array.from(
    new Set([...Object.keys(A.scenarios || {}), ...Object.keys(B.scenarios || {})])
  );
  for (const n of ns) {
    table(
      A.scenarios[n] && A.scenarios[n].median,
      B.scenarios[n] && B.scenarios[n].median,
      `N=${n} (median of runs)`
    );
  }
} else {
  table(A.median, B.median, 'client (median of runs)');
}
console.log(
  '\nNoise guide: CPU-seconds and RSS typically vary ~5-15% run to run on a busy machine; treat smaller deltas as noise.'
);
