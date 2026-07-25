// Script / integrated-event execution contracts.

/** Correlates a dispatched task with its asynchronous response. */
export type ExecutionRequestID = string;

/**
 * Ack payload of the client's `GetLaunchConfig` request — the per-client
 * run-on-launch configuration.
 *
 * The server is the single source of truth; the client fetches this fresh on
 * every connection and never persists it. Integrated and unadopted clients get
 * a null `ScriptID`. The client re-normalizes and clamps `DelaySeconds` on
 * receipt (see the client's `LaunchConfig` module), so this describes what the
 * server sends, not a validated shape.
 */
export interface LaunchConfigPayload {
  ScriptID: string | null;
  /** Seconds to wait before firing; doubles as the abort-window countdown. */
  DelaySeconds: number | null;
  /** Global operator toggle for the on-screen abort countdown. */
  ShowCountdown: boolean;
}

/** Server -> client payload accompanying a LAN software update. */
export interface UpdateSoftwareFromLANPayload {
  /** Path appended to the server origin to build the update feed URL. */
  FeedPath?: string;
  ReleaseVersion?: string | null;
}
