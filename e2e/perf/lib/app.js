'use strict';
// Launch / kill / inspect helpers shared by both harnesses.
const fs = require('fs');
const { psAll, descendantsOf } = require('./proctree');
const { readJson, sleep, waitFor } = require('./common');

// SIGKILL the app so no quit/save flow runs. Main first, and only then the
// helpers: a helper that died while main was alive would be reaped by main and
// its CPU would leak into the "short-lived children" figure from wait4().
async function killTree(launch) {
  const map = await psAll();
  const main = map.get(launch.mainPid);
  const mainOwnCpu = main ? main.cpu : null;
  const helpers = main ? descendantsOf(map, launch.mainPid) : [];
  try {
    process.kill(launch.mainPid, 'SIGKILL');
  } catch {
    /* already gone */
  }
  let rusage;
  try {
    rusage = await waitFor(() => readJson(launch.rusageFile), {
      timeoutMs: 15000,
      intervalMs: 50,
      what: 'rusage',
    });
  } catch {
    rusage = null;
  }
  for (const pid of helpers) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* gone */
    }
  }
  // Make sure nothing of ours survives.
  for (let i = 0; i < 50; i++) {
    const alive = helpers.filter((pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    });
    if (!alive.length) break;
    alive.forEach((pid) => {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* gone */
      }
    });
    await sleep(100);
  }
  return {
    mainOwnCpu,
    rusage,
    // CPU of every process the main process started and reaped over its whole
    // life (lsappinfo, vm_stat, ioreg, a renderer that exited, ...).
    reapedChildrenCpuLifetime:
      rusage && mainOwnCpu !== null ? Number((rusage.cpu - mainOwnCpu).toFixed(3)) : null,
  };
}

// Evaluate an expression in the Electron MAIN process through the Node
// inspector. The inspector is activated with SIGUSR1 on demand (launch with
// NODE_OPTIONS=--inspect-port=<port>), so it is off while measuring.
async function enableInspector(mainPid, port) {
  process.kill(mainPid, 'SIGUSR1');
  return waitFor(
    async () => {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/json/list`);
        const list = await r.json();
        return list && list[0] && list[0].webSocketDebuggerUrl
          ? list[0].webSocketDebuggerUrl
          : null;
      } catch {
        return null;
      }
    },
    { timeoutMs: 10000, intervalMs: 200, what: 'inspector' }
  );
}

function inspectorEval(wsUrl, expression, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      reject(new Error('inspector eval timeout'));
    }, timeoutMs);
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: {
            expression,
            awaitPromise: true,
            returnByValue: true,
            includeCommandLineAPI: true,
          },
        })
      );
    };
    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
      } catch {
        return;
      }
      if (msg.id !== 1) return;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      if (msg.error) return reject(new Error(JSON.stringify(msg.error)));
      const r = msg.result || {};
      if (r.exceptionDetails)
        return reject(new Error(JSON.stringify(r.exceptionDetails).slice(0, 500)));
      resolve(r.result ? r.result.value : undefined);
    };
    ws.onerror = (e) => {
      clearTimeout(timer);
      reject(new Error('inspector ws error ' + (e && e.message)));
    };
  });
}

function tail(file, n = 40) {
  try {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    return lines.slice(-n).join('\n');
  } catch {
    return '';
  }
}

module.exports = { killTree, enableInspector, inspectorEval, tail };
