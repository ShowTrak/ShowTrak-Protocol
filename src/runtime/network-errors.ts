// Central classifier for transient/benign network errors.
//
// When a host loses connectivity — Ethernet unplugged, Wi-Fi turned off, a VPN
// dropping, a NIC being removed — sockets that were mid-flight throw system
// errors from deep inside libuv/Node that an ordinary try/catch cannot wrap
// (they surface asynchronously in a dgram send callback or a socket 'error'
// event). The canonical symptom is the mDNS responder/browser throwing:
//
//     Error: send EADDRNOTAVAIL 224.0.0.251:5353
//         at doSend (node:dgram:...)
//
// These are expected, self-healing conditions: the interface poller re-joins
// groups, discovery restarts, and the sockets rebind once connectivity returns.
// So instead of crashing, this recognises the class in one place and downgrades
// it to a logged warning wherever it can reach us.
//
// Shared by ShowTrakServer and ShowTrakClient. It lived as two near-identical
// copies until the Client needed CreateBonjourErrorHandler too, at which point
// the duplication was actively costing.

// System error codes that all mean "the network went away / is unreachable" or
// "the socket/stream is being torn down". None indicate a bug on our side; every
// one is recoverable once connectivity is restored (or is a harmless teardown
// race).
export const TRANSIENT_NETWORK_ERROR_CODES: ReadonlySet<string> = new Set([
  'EADDRNOTAVAIL', // the bound source address vanished (interface gone)
  'ENETUNREACH', // no route to the network (e.g. all interfaces down)
  'ENETDOWN', // the network interface is administratively/physically down
  'ENETRESET', // connection aborted by the network
  'EHOSTUNREACH', // no route to host
  'EHOSTDOWN', // host is down
  'ENODEV', // no such device (interface removed out from under us)
  'EPIPE', // broken pipe during a send — also a closed stdout when run detached
  'ECONNRESET', // peer/ICMP reset
  'ECONNREFUSED', // ICMP port-unreachable surfaced on a prior UDP send
  'ERR_SOCKET_DGRAM_NOT_RUNNING', // sent on a dgram socket that is already closing
  'ERR_SOCKET_CANNOT_SEND', // dgram send attempted after teardown
]);

// Pull a system error code off an unknown throwable. Node puts it on `.code`;
// as a fallback we scan the message for a known token (some libraries wrap the
// original error and only preserve the text, e.g. "send EADDRNOTAVAIL ...").
function ExtractCode(Err: unknown): string | null {
  if (!Err || typeof Err !== 'object') {
    // A bare string like "send EADDRNOTAVAIL 224.0.0.251:5353" can still be classified.
    if (typeof Err === 'string') {
      for (const Code of TRANSIENT_NETWORK_ERROR_CODES) {
        if (Err.includes(Code)) return Code;
      }
    }
    return null;
  }
  const Code = (Err as { code?: unknown }).code;
  if (typeof Code === 'string' && Code) return Code;
  const Message = (Err as { message?: unknown }).message;
  if (typeof Message === 'string') {
    for (const Candidate of TRANSIENT_NETWORK_ERROR_CODES) {
      if (Message.includes(Candidate)) return Candidate;
    }
  }
  return null;
}

// True when an error is a transient/benign network condition that should be
// logged-and-ignored rather than crashing the process.
export function IsTransientNetworkError(Err: unknown): boolean {
  const Code = ExtractCode(Err);
  return Code != null && TRANSIENT_NETWORK_ERROR_CODES.has(Code);
}

// Human-readable one-liner for logs.
export function DescribeError(Err: unknown): string {
  if (Err && typeof Err === 'object' && 'message' in Err) {
    const M = (Err as { message?: unknown }).message;
    if (typeof M === 'string' && M) return M;
  }
  return String(Err);
}

// Minimal logger surface used by CreateBonjourErrorHandler. Structural on
// purpose: this package must not depend on either app's Logger, and a test can
// pass a plain object.
export interface LoggerLike {
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

// Build the `errorCallback` bonjour-service invokes when an mDNS send fails.
//
// This is NOT optional for either app. The library's default is
// `function (err) { throw err }`, raised from inside a dgram send callback where
// no caller-side try/catch can reach it — so on a packaged build an ordinary
// interface drop would terminate the process. Supplying a handler is what keeps
// a NIC flap a logged warning instead.
export function CreateBonjourErrorHandler(Logger: LoggerLike): (Err: unknown) => void {
  return (Err: unknown) => {
    if (IsTransientNetworkError(Err)) {
      Logger.warn(`mDNS send skipped — network unavailable (${DescribeError(Err)})`);
      return;
    }
    // Anything else is unexpected but still must not crash the app: an mDNS send
    // failure is never worth taking the whole process down for.
    Logger.error(`mDNS error: ${DescribeError(Err)}`);
  };
}
