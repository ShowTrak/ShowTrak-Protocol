'use strict';
// Evaluate an expression in an Electron renderer through the DevTools protocol
// (the app is launched with --remote-debugging-port). Uses Node's global
// fetch and WebSocket (Node 22+).

async function pageTarget(port) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page =
    targets.find((t) => t.type === 'page' && /index\.html/.test(t.url)) ||
    targets.find((t) => t.type === 'page');
  if (!page) throw new Error(`no page target on DevTools port ${port}`);
  return page;
}

async function rendererEval(port, expression, timeoutMs = 15000) {
  const page = await pageTarget(port);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('DevTools socket error'));
  });
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('DevTools evaluate timed out')), timeoutMs);
      ws.onmessage = (msg) => {
        const data = JSON.parse(typeof msg.data === 'string' ? msg.data : msg.data.toString());
        if (data.id !== 1) return;
        clearTimeout(timer);
        const r = data.result || {};
        if (data.error) return reject(new Error(JSON.stringify(data.error)));
        if (r.exceptionDetails)
          return reject(new Error(JSON.stringify(r.exceptionDetails).slice(0, 400)));
        resolve(r.result ? r.result.value : undefined);
      };
      ws.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true, returnByValue: true },
        })
      );
    });
  } finally {
    ws.close();
  }
}

module.exports = { rendererEval };
