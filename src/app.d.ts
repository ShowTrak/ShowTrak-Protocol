// Plumbing every ShowTrak desktop app shares (Server, Client and Timers): the
// conventions their main and renderer processes speak across Electron's IPC,
// the self-updater's status, show files, and the settings framework.
//
// Re-exported from the package root (ShowTrak Server's surface) and, name by
// name, from the `@showtrak/protocol/client` and `@showtrak/protocol/timers`
// entry points, so each app imports it from the entry point it already uses.

// ---- IPC conventions --------------------------------------------------------

/** Unsubscribe handle returned by every `subscribe`-backed preload method. */
export type Unsubscribe = () => void;

/** A successful `[error, value]` answer. */
export type Ok<T> = [error: null, value: T];

/** A failed `[error, value]` answer: the message, and no value. */
export type Failure = [error: string, value: null];

/**
 * The `[error, value]` tuple every ShowTrak app's managers return, and the
 * answer an IPC handler sends back across the bridge instead of throwing.
 * Discriminated on the error slot, so `if (Err)` narrows the value.
 */
export type Result<T> = Ok<T> | Failure;

/**
 * The loose form of {@link Result}, as ShowTrak Server and ShowTrak Timers type
 * their renderer-facing IPC answers. Looser than `Result` on purpose: some
 * handlers answer `[null, null]` for "nothing to report" (for example
 * `OpenRequestedShow` with no file waiting), which `Result<T>` cannot express
 * unless `T` includes null.
 */
export type ResultTuple<T = unknown> = [error: string | null, value: T | null];

// ---- Channel allowlists -----------------------------------------------------
//
// A sandboxed preload cannot import the app's channel lists at runtime, so each
// app inlines them. These helpers let an app prove at compile time that a
// runtime list names exactly the channels a contract here declares.

/**
 * `true` when the runtime list `Listed` names exactly the channels in the union
 * `Declared`: every listed channel is declared, and every declared channel is
 * listed. Otherwise an object naming the offenders, so the compile error says
 * what is wrong. Use it through {@link AssertTrue}:
 *
 * ```ts
 * const INVOKE = ['Timers:List', 'Timer:Get'] as const;
 * type _InvokeComplete = AssertTrue<ChannelListCheck<InvokeChannel, typeof INVOKE>>;
 * ```
 */
export type ChannelListCheck<Declared extends string, Listed extends readonly string[]> = [
  Exclude<Listed[number], Declared>,
  Exclude<Declared, Listed[number]>,
] extends [never, never]
  ? true
  : {
      /** Listed at runtime but not declared in the contract. */
      Undeclared: Exclude<Listed[number], Declared>;
      /** Declared in the contract but missing from the runtime list. */
      Unlisted: Exclude<Declared, Listed[number]>;
    };

/** Fails to compile unless `T` is `true`. */
export type AssertTrue<T extends true> = T;

// ---- Application mode -------------------------------------------------------

/**
 * Show Mode (operate) or Edit Mode (change the show). ShowTrak Server and
 * ShowTrak Timers both normalise anything else to 'SHOW' before it is stored
 * or sent, so no other value ever crosses the bridge.
 */
export type AppMode = 'SHOW' | 'EDIT';

// ---- Self-update ------------------------------------------------------------

/**
 * Which releases an app (or a client deployment) moves to.
 *
 * The same union as `UpdateChannel` in `@showtrak/protocol/runtime`, which is
 * what the apps' code normalises with at runtime. It is declared again here
 * because these ambient declarations cannot import runtime source without
 * dragging it into every app's program; the type tests check the two match.
 */
export type UpdateChannel = 'stable' | 'beta';

/** Every state an app's self-updater reports (`AppUpdate:Status` / `OnAppUpdateStatus`). */
export type AppUpdateState =
  | 'checking'
  | 'available'
  | 'none'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'installed'
  | 'error';

/**
 * What a status says about the release, when it says anything. Producers pass
 * electron-updater's `UpdateInfo` straight through (so its other keys, such as
 * `files` and `sha512`, arrive too), or a small stand-in: `{ version }` or
 * `{ tag }` from the Squirrel and simulated paths, `{ reason, details }` when a
 * check could not run.
 */
export interface AppUpdateInfo {
  version?: string;
  tag?: string;
  releaseName?: string | null;
  releaseDate?: string;
  /** electron-updater: a string, a list of `{ version, note }`, or null. */
  releaseNotes?: unknown;
  notes?: unknown;
  body?: unknown;
  /** Why a check could not run, e.g. 'linux_updates_unavailable', 'check_timeout'. */
  reason?: string;
  details?: string;
}

/**
 * A self-update status, pushed from the main process to the renderer.
 * ShowTrak Server, ShowTrak Client and ShowTrak Timers all send this shape.
 */
export interface AppUpdateStatus {
  state: AppUpdateState;
  /**
   * The release, while one is known. A 'downloading' tick carries the info the
   * 'available' status had, so a late listener can still name the version.
   */
  info?: AppUpdateInfo | null;
  /** Download progress, 0-100, during 'downloading'. */
  percent?: number;
  /** Set by the development-only simulated update flow. */
  simulated?: boolean;
  /** The failure, on 'error'. */
  error?: string;
}

/**
 * One package line of a Squirrel.Windows RELEASES manifest
 * (`<SHA1> <file> <size>`), as ShowTrak Server and ShowTrak Timers parse it to
 * learn the incoming version and report download progress. Squirrel itself
 * reports neither.
 */
export interface SquirrelPackage {
  /** `<name>-<version>-full.nupkg` or `<name>-<version>-delta.nupkg`. */
  fileName: string;
  version: string;
  /** Bytes. */
  size: number;
}

// ---- Show files -------------------------------------------------------------

/**
 * The version stamps a show file carries (ShowTrak Server and ShowTrak Timers
 * show files are SQLite databases). Null when the file predates the stamp.
 */
export interface ShowFileInfo {
  CreatedWithVersion: string | null;
  SavedWithVersion: string | null;
  /** The file's schema version (SQLite user_version), when it could be read. ShowTrak Timers only. */
  SchemaVersion?: number | null;
}

/** A show file last saved by an older version, awaiting the operator's go-ahead to upgrade. */
export interface ShowFileUpgrade {
  FilePath: string;
  FileName: string;
  /** The version that last saved the file; null when it predates version stamping. */
  FileVersion: string | null;
  CurrentVersion: string;
}

/** What opening a show file came to: opened, or waiting on an upgrade the operator must accept. */
export type ShowFileOpenOutcome =
  { Status: 'Opened'; FilePath: string } | { Status: 'UpgradeRequired'; Upgrade: ShowFileUpgrade };

/** How a show file opened from the operating system arrived: it launched the app, or reached it running. */
export type ShowFileRequestSource = 'Launch' | 'Running';

/** A show file the operating system asked the app to open (double-click, Open With). */
export interface ShowFileRequest {
  FilePath: string;
  Source: ShowFileRequestSource;
}

// ---- Settings ---------------------------------------------------------------
//
// ShowTrak Server and ShowTrak Timers share one settings framework: a table of
// definitions in the main process, resolved against stored values into the
// settings the Preferences modal renders.

/** STRING is free text, PASSWORD masked text, OPTION one of Options, SLIDER an INTEGER drawn as a range. */
export type SettingType = 'BOOLEAN' | 'INTEGER' | 'STRING' | 'PASSWORD' | 'OPTION' | 'SLIDER';

export type SettingValue = boolean | number | string;

/**
 * Where a setting's value is kept. 'INSTALL' keeps it with this installation,
 * so opening another show file does not change it; absent (or null on a
 * resolved setting) keeps it in the show file.
 */
export type SettingScope = 'INSTALL';

/** One entry of an app's settings table (main process only; never serialised). */
export interface SettingDefinition<Type extends SettingType = SettingType> {
  Group: string;
  Key: string;
  Title: string;
  Description: string;
  Type: Type;
  DefaultValue: SettingValue;
  Min?: number;
  Max?: number;
  Options?: string[];
  /** Unit label shown beside numeric and slider values, e.g. '%' or 'ms'. */
  Unit?: string;
  /** Broadcast after the value changes, so the owning service can re-apply it. */
  OnUpdateEvent?: string;
  Scope?: SettingScope;
  /**
   * Shown in Preferences only while every BOOLEAN setting named here is on.
   * Presentational: a hidden setting keeps its value.
   */
  ShowWhen?: string[];
}

/** A settings group: one Preferences tab, or a heading inside its parent's tab. */
export interface SettingGroup {
  Name: string;
  Title: string;
  /** As SettingDefinition.ShowWhen, for the whole group and its tab. */
  ShowWhen?: string[];
  /** Renders inside this group's tab, under its own heading, not as a tab. The parent comes first. */
  Parent?: string;
}

/** A setting resolved against its stored value, as the renderer receives it. */
export interface Setting<Type extends SettingType = SettingType> {
  Group: string;
  Key: string;
  Title: string;
  Description: string;
  Type: Type;
  Value: SettingValue;
  isDefault: boolean;
  DefaultValue: SettingValue;
  OnUpdateEvent: string | null;
  Options: string[] | null;
  Min: number | null;
  Max: number | null;
  Unit: string | null;
  ShowWhen: string[] | null;
  Scope: SettingScope | null;
}
