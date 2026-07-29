// Integrated-client (SDK) surface: declared actions and self-reported state.

/**
 * An action ("event") declared by an integrated client via the ShowTrak
 * Integration SDK (`RegisterActions`).
 */
export interface IntegratedAction {
  /** Matches `^[A-Za-z0-9_.-]+$`. */
  ID: string;
  Label: string;
  /** Colour palette index, 0-7. */
  ColourIndex: number;
  /**
   * Bare Bootstrap Icons name (no `bi-` prefix), e.g. `"lightning-charge-fill"`.
   * Optional on the wire: SDKs that predate icons simply omit it, and the
   * server substitutes `"terminal"`. Always present on actions the server has
   * normalized, so consumers of a serialized client can read it directly.
   */
  Icon?: string;
  /** When true, the server waits for an `IntegratedEventResponse`. */
  HasFeedback: boolean;
  /**
   * How long the client gives its own handler before it self-resolves the
   * event as timed out. The server arms a watchdog slightly beyond this so a
   * device that disappears mid-event cannot leave the execution row pending,
   * while a device that is merely slow still reports its own outcome first.
   * Absent from SDKs that predate the feature; the server substitutes its
   * default.
   */
  TimeoutMs?: number;
}

/**
 * Health state an integrated client may self-report via `SetIntegratedState`.
 * `OFFLINE` is never accepted from the client.
 */
export type IntegratedState = 'ONLINE' | 'DEGRADED';
