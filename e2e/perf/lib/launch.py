#!/usr/bin/env python3
"""Spawn a command, record its pid, wait for it with wait4() and write the
rusage to a JSON file.

wait4() on macOS returns the child's own CPU time PLUS that of every
descendant it reaped (XNU folds p_cru into the exiting process's rusage), so
(utime + stime) - <main's own CPU just before it was killed> = CPU burnt by
short-lived children (lsappinfo, vm_stat, ioreg, ...) over the app's lifetime.
Electron helper processes are NOT included: the harness SIGKILLs the main
process first, so the helpers are never reaped by it.

Usage: launch.py <out.json> <cmd> [args...]
"""
import json
import os
import signal
import subprocess
import sys
import time

out = sys.argv[1]
cmd = sys.argv[2:]
started = time.time()
proc = subprocess.Popen(cmd)
with open(out + '.pid', 'w') as fh:
    fh.write(str(proc.pid))


def forward(signum, _frame):
    try:
        os.kill(proc.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


signal.signal(signal.SIGTERM, forward)
signal.signal(signal.SIGINT, forward)
pid, status, ru = os.wait4(proc.pid, 0)
result = {
    'pid': pid,
    'status': status,
    'signaled': os.WIFSIGNALED(status),
    'termsig': os.WTERMSIG(status) if os.WIFSIGNALED(status) else None,
    'exitcode': os.WEXITSTATUS(status) if os.WIFEXITED(status) else None,
    'utime': ru.ru_utime,
    'stime': ru.ru_stime,
    'cpu': ru.ru_utime + ru.ru_stime,
    'maxrss_bytes': ru.ru_maxrss,
    'wall': time.time() - started,
}
tmp = out + '.tmp'
with open(tmp, 'w') as fh:
    json.dump(result, fh)
os.rename(tmp, out)
