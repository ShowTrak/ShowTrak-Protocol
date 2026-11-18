// Script / integrated-event execution contracts.

/** Correlates a dispatched task with its asynchronous response. */
export type ExecutionRequestID = string;

/** A batch of a running script's console output, in the order it was written. */
export interface ScriptOutputChunk {
  Stream: 'stdout' | 'stderr';
  Text: string;
}

/**
 * One entry of an execution's console history, as the server records it.
 *   - `stage`: a lifecycle step (Queued, Sent to client, Preparing, Running ...);
 *   - `stdout` / `stderr`: console output streamed by the client;
 *   - `tail`: the latest output line a client reports in its progress updates.
 *     Older clients send only this, so it is recorded only until real output
 *     arrives (it would duplicate it);
 *   - `result`: how the execution ended (`Error` set when it failed).
 */
export interface ExecutionLogEntry {
  Seq: number;
  Time: number;
  Kind: 'stage' | 'stdout' | 'stderr' | 'tail' | 'result';
  Text: string;
  Error?: boolean;
}

/** Reply to a console request: the entries after `AfterSeq`, plus where the run is. */
export interface ExecutionOutputView {
  RequestID: ExecutionRequestID;
  Status: 'Pending' | 'Failed' | 'Completed';
  Entries: ExecutionLogEntry[];
  /** The highest Seq recorded so far (pass it back as the next AfterSeq). */
  LastSeq: number;
  /** Earlier output was dropped to stay under the per-execution cap. */
  Trimmed: boolean;
  /** Whether the client streamed real console output (false for older clients). */
  HasStreamOutput: boolean;
  /** The client stopped sending output after hitting its own cap. */
  ClientTruncated: boolean;
}

/**
 * Ack payload of the client's `GetLaunchConfig` request: the per-client
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
