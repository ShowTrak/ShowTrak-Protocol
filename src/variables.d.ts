// Show Variables — operator-defined key/value pairs that reach a client's
// scripts as environment variables.
//
// A variable is defined once per show (a `VariableView`), carries a default
// value, and may be overridden per client. What actually crosses the wire to a
// client is the *resolved* map (a `VariableEnvironment`): every defined
// variable, already prefixed and already collapsed down to the single value
// that client should see. The client never learns about defaults, overrides or
// variable IDs — it receives a finished environment block and injects it.

/**
 * The prefix every show variable carries once it reaches a script.
 *
 * A variable named `GAME_VERSION` is `%SHOWTRAK_VAR_GAME_VERSION%` on Windows
 * and `$SHOWTRAK_VAR_GAME_VERSION` elsewhere. The prefix exists so a show can
 * never shadow `PATH`, `TEMP` or any other environment variable the OS or the
 * script's own tooling depends on.
 */
export type VariablePrefix = 'SHOWTRAK_VAR_';

/**
 * A variable definition as the operator sees it in the Variable Manager.
 *
 * `Key` is the bare, un-prefixed name (`GAME_VERSION`). It is normalized to
 * upper snake case on write because the Windows environment is
 * case-insensitive: `Game_Version` and `GAME_VERSION` would be one variable
 * there and two on POSIX, so only one spelling is ever allowed to exist.
 */
export interface VariableView {
  VariableID: number;
  /** Bare name, without the `SHOWTRAK_VAR_` prefix. */
  Key: string;
  /** Fully-qualified environment variable name, prefix included. */
  EnvironmentKey: string;
  Description: string;
  /** Used by any client that has not set its own value. May be empty. */
  DefaultValue: string;
  /**
   * Whether this variable is also written into the Windows user environment
   * (HKCU) so applications outside ShowTrak can read it. Ignored on macOS and
   * Linux clients, which have no equivalent that works reliably.
   */
  ExportToSystem: boolean;
  Weight: number;
  /**
   * Number of clients holding an explicit override. Display only — lets the
   * manager show "3 clients override this" without a second round trip.
   */
  OverrideCount: number;
}

/**
 * One client's view of a single variable, as rendered in the client editor.
 * `Value` is null when the client inherits, in which case `DefaultValue` is
 * what its scripts will see.
 */
export interface ClientVariableView {
  VariableID: number;
  Key: string;
  EnvironmentKey: string;
  Description: string;
  DefaultValue: string;
  ExportToSystem: boolean;
  /** The client's own override, or null when it inherits the default. */
  Value: string | null;
  /** What this client resolves to right now (`Value ?? DefaultValue`). */
  ResolvedValue: string;
}

/**
 * The resolved environment pushed to a client: prefixed name -> value.
 *
 * Every defined variable is always present, even when its value is empty.
 * Omitting an unset variable would leave `%SHOWTRAK_VAR_X%` in a batch file as
 * the literal text `%SHOWTRAK_VAR_X%` rather than as nothing, which is a
 * confusing failure for script authors.
 */
export type VariableEnvironment = Record<string, string>;

/**
 * What the client needs in order to mirror variables into the Windows user
 * environment: the resolved values plus the subset of names the operator marked
 * exportable. Names absent from `Exported` are injected into scripts only.
 */
export interface VariablePayload {
  Environment: VariableEnvironment;
  /** Prefixed names that should also be written to HKCU on Windows clients. */
  Exported: string[];
}
