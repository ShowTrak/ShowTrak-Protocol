// Process-wide last line of defence for faults nothing else caught.
//
// Most of an app's sockets handle their own 'error' events. But some errors
// originate several layers deep in third-party libraries or native code and
// surface as an uncaught exception or unhandled rejection before any try/catch
// or per-socket handler can see them, the classic case being the mDNS
// responder throwing `send EADDRNOTAVAIL 224.0.0.251:5353` the instant Ethernet
// is unplugged or Wi-Fi is switched off, or `write EPIPE` from a console write
// after the pipe the app was launched with has closed.
//
// This installs one `uncaughtException` / `unhandledRejection` pair that:
//   - Swallows transient network errors (interface loss is expected and
//     self-heals) with a warning, so a NIC flap never takes an app down.
//   - Logs anything else loudly as a fatal-but-survived error. It deliberately
//     does NOT exit: a show-control server, a timer running a show and an
//     unattended client agent are all better up and degraded than dead (a dead
//     agent needs a physical visit). Genuine bugs stay visible in the logs at
//     error level.
//
// ShowTrak Server, Client and Timers each had a copy of this; call it first
// thing in the main process, before anything that could throw or spawn.
import type { AppLoggerLike } from './logging';
import { DescribeError, IsTransientNetworkError } from './network-errors';

let Installed = false;

/**
 * Install the guards, logging through `Logger` (the app's
 * `CreateLogger('ProcessGuard')`). Once per process: later calls do nothing,
 * so the handlers never stack and log a fault twice.
 */
export function InstallProcessGuards(Logger: AppLoggerLike): void {
  if (Installed) return;
  Installed = true;

  process.on('uncaughtException', (Err: unknown) => {
    if (IsTransientNetworkError(Err)) {
      Logger.warn(`Ignored transient network error: ${DescribeError(Err)}`);
      return;
    }
    Logger.error('Uncaught exception (app kept alive):', Err);
  });

  process.on('unhandledRejection', (Reason: unknown) => {
    if (IsTransientNetworkError(Reason)) {
      Logger.warn(`Ignored transient network rejection: ${DescribeError(Reason)}`);
      return;
    }
    Logger.error('Unhandled promise rejection (app kept alive):', Reason);
  });

  Logger.log('Process-level fault guards installed');
}
