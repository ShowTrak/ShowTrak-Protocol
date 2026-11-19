// CPU-profile the Electron main process over its --inspect port.
//   node profile-main.js --port 9230 --secs 15
const C = require('./lib/common');
const path = require('node:path');
const fs = require('node:fs');
const opts = C.parseArgs(process.argv.slice(2), { port: 9230, secs: 15, out: 'work/main' });
(async () => {
  const targets = await (await fetch(`http://127.0.0.1:${opts.port}/json/list`)).json();
  const t = targets[0];
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((r) => {
      const i = ++id;
      pending.set(i, r);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  await send('Profiler.enable');
  await send('Profiler.setSamplingInterval', { interval: 100 });
  await send('Profiler.start');
  await C.sleep(opts.secs * 1000);
  const { result } = await send('Profiler.stop');
  ws.close();
  const p = result.profile;
  fs.writeFileSync(`${opts.out}.cpuprofile`, JSON.stringify(p));
  const nodes = new Map(p.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of p.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const self = new Map();
  const total = new Map();
  let all = 0;
  for (let i = 0; i < p.samples.length; i++) {
    const dt = p.timeDeltas[i] || 0;
    all += dt;
    let n = nodes.get(p.samples[i]);
    const key = (n) =>
      `${n.callFrame.functionName || '(anon)'} ${path.basename(n.callFrame.url || '')}:${n.callFrame.lineNumber + 1}`;
    self.set(key(n), (self.get(key(n)) || 0) + dt);
    const seen = new Set();
    for (let id = n.id; id != null; id = parent.get(id)) {
      const k = key(nodes.get(id));
      if (seen.has(k)) continue;
      seen.add(k);
      total.set(k, (total.get(k) || 0) + dt);
    }
  }
  const idle = self.get('(idle) :0') || 0;
  console.log(`main busy ${((all - idle) / 1000).toFixed(0)} ms of ${(all / 1000).toFixed(0)} ms`);
  console.log('self:');
  for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 22))
    console.log(`  ${(v / 1000).toFixed(0).padStart(6)} ms  ${k}`);
  console.log('inclusive:');
  for (const [k, v] of [...total]
    .sort((a, b) => b[1] - a[1])
    .filter(([k]) => !/^\((root|program|idle)\)/.test(k))
    .slice(0, 30))
    console.log(`  ${(v / 1000).toFixed(0).padStart(6)} ms  ${k}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
