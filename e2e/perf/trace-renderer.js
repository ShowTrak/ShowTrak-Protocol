// Attach to a running Electron renderer over the DevTools protocol and record
// (a) a timeline trace and (b) a JS CPU profile, then summarise where the
// renderer main thread spends its time.
//   node trace-renderer.js --port 9333 --secs 10 --out work/trace-x
const fs = require('node:fs');
const path = require('node:path');
const C = require('./lib/common');
const opts = C.parseArgs(process.argv.slice(2), {
  port: 9333,
  secs: 10,
  out: 'work/trace',
  match: 'index.html',
  inject: '',
});

async function main() {
  const targets = await (await fetch(`http://127.0.0.1:${opts.port}/json/list`)).json();
  const page =
    targets.find((t) => t.type === 'page' && t.url.includes(opts.match)) ||
    targets.find((t) => t.type === 'page');
  if (!page)
    throw new Error('no page target: ' + JSON.stringify(targets.map((t) => [t.type, t.url])));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let id = 0;
  const pending = new Map();
  const traceEvents = [];
  let traceDone;
  const traceComplete = new Promise((r) => (traceDone = r));
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method === 'Tracing.dataCollected') traceEvents.push(...msg.params.value);
    else if (msg.method === 'Tracing.tracingComplete') traceDone();
  };
  const send = (method, params = {}) =>
    new Promise((r) => {
      const i = ++id;
      pending.set(i, r);
      ws.send(JSON.stringify({ id: i, method, params }));
    });

  if (opts.inject) {
    const r = await send('Runtime.evaluate', { expression: opts.inject });
    console.log('injected:', JSON.stringify(r.result && r.result.result).slice(0, 120));
    await C.sleep(3000);
  }
  await send('Profiler.enable');
  await send('Profiler.setSamplingInterval', { interval: 200 });
  await send('Tracing.start', {
    categories: 'devtools.timeline,disabled-by-default-devtools.timeline,v8.execute,blink,cc,gpu',
    transferMode: 'ReportEvents',
  });
  await send('Profiler.start');
  await C.sleep(Number(opts.secs) * 1000);
  const prof = await send('Profiler.stop');
  await send('Tracing.end');
  await traceComplete;
  ws.close();

  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  fs.writeFileSync(`${opts.out}.cpuprofile`, JSON.stringify(prof.result.profile));
  fs.writeFileSync(`${opts.out}.trace.json`, JSON.stringify({ traceEvents }));

  // Timeline: top-level durations on the renderer main thread (CrRendererMain).
  const threadNames = new Map();
  for (const e of traceEvents)
    if (e.name === 'thread_name') threadNames.set(`${e.pid}:${e.tid}`, e.args.name);
  const mainKeys = new Set(
    [...threadNames].filter(([, n]) => n === 'CrRendererMain').map(([k]) => k)
  );
  const byName = new Map();
  let busy = 0;
  // Sum self time per event name on the main thread (complete 'X' events).
  const evs = traceEvents.filter((e) => e.ph === 'X' && mainKeys.has(`${e.pid}:${e.tid}`) && e.dur);
  evs.sort((a, b) => a.ts - b.ts || b.dur - a.dur);
  const stack = [];
  for (const e of evs) {
    while (stack.length && stack[stack.length - 1].end <= e.ts) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) parent.self -= e.dur;
    else busy += e.dur;
    const node = { name: e.name, end: e.ts + e.dur, self: e.dur };
    stack.push(node);
    node.ref = byName.get(e.name) || { self: 0, total: 0, count: 0 };
    node.ref.total += e.dur;
    node.ref.count += 1;
    byName.set(e.name, node.ref);
    e._node = node;
  }
  for (const e of evs) e._node.ref.self += e._node.self;
  const top = [...byName].sort((a, b) => b[1].self - a[1].self).slice(0, 18);
  console.log(
    `renderer main thread busy: ${(busy / 1000).toFixed(0)} ms of ${opts.secs * 1000} ms`
  );
  for (const [n, v] of top)
    console.log(
      `  ${n.padEnd(34)} self ${(v.self / 1000).toFixed(0).padStart(6)} ms  total ${(v.total / 1000).toFixed(0).padStart(6)} ms  x${v.count}`
    );

  // JS profile: self time per function.
  const p = prof.result.profile;
  const self = new Map();
  const dt = p.timeDeltas || [];
  const nodes = new Map(p.nodes.map((n) => [n.id, n]));
  for (let i = 0; i < p.samples.length; i++) {
    const n = nodes.get(p.samples[i]);
    const key = `${n.callFrame.functionName || '(anon)'} ${path.basename(n.callFrame.url || '')}:${n.callFrame.lineNumber + 1}`;
    self.set(key, (self.get(key) || 0) + (dt[i] || 0));
  }
  console.log('JS self time (top 25):');
  for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 25))
    console.log(`  ${(v / 1000).toFixed(0).padStart(6)} ms  ${k}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
