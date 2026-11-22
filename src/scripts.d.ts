// The script catalog: what a ShowTrak Server knows about each folder in its
// scripts directory, and how it ships that catalog to:
//   - clients, as the `GetScripts` acknowledgement (see events.d.ts);
//   - its renderer, Web UI and `/sdk` sessions, as the `SetScriptList` push.
//
// Two layers, because the two ends of the client wire are not the same age:
//   - `ScriptCatalogScript` / `ScriptCatalogInvalidScript` (union
//     `ScriptCatalogEntry`) are exactly what the CURRENT Server sends. Its
//     `Script` and `InvalidScript` classes implement them.
//   - `ScriptCatalogWireEntry` is what ANY supported Server sends, back to
//     3.0.0, legacy fields included. It is what a client must be written
//     against, because a new client is still adopted by older Servers.

// ---- Building blocks --------------------------------------------------------

/** A platform a script can target: the keys of `Platforms` and `Arguments`, in display order. */
export type ScriptPlatform = 'Windows' | 'macOS' | 'Linux';

/**
 * A per-platform map keyed by {@link ScriptPlatform}: the script file to launch
 * (`Platforms`) or its argument string (`Arguments`). Servers from 3.3.0 always
 * send all three keys, with an empty string for "none on this platform".
 * Typed with string keys so a reader can index it with any platform name.
 */
export type ScriptPlatformMap = Record<string, string>;

/** How a console filter matches a line. */
export type ScriptConsoleFilterMode = 'none' | 'startsWith' | 'includes' | 'regex';

/**
 * Console filter applied CLIENT-SIDE while a script runs: only console lines
 * matching `Pattern` under `Mode` are surfaced as the live status tail. Mode
 * `none` (or an empty `Pattern`) disables filtering. When `Strip` is true the
 * matched text is removed from the surfaced line, leaving only the remainder.
 *
 * Sent by Servers from 3.12.0, always normalised: a mode outside the four is
 * reset to `none` before it is stored or sent, and `Strip` is always present.
 * A regex `Pattern` may still fail to compile; the client disables it then.
 */
export interface ScriptConsoleFilter {
  Mode: ScriptConsoleFilterMode;
  Pattern: string;
  Strip: boolean;
}

/** One entry in a script folder's file listing, as the client downloads it. */
export interface ScriptFileEntry {
  /** Relative to the script folder, with the Server OS's separators. */
  Path: string;
  Type: 'file' | 'directory';
  /**
   * SHA-1 hex digest of a file (see `ChecksumFile` in the runtime entry), which
   * the client compares before downloading and verifies after. Null when the
   * Server could not read the file; absent on directories.
   */
  Checksum?: string | null;
}

/**
 * How hard a script asks before it runs. "Critical" is a full-screen red
 * warning whose default action is Cancel. On disk this is the `Confirmation`
 * boolean plus an optional `ConfirmationStyle: "Critical"`.
 */
export type ScriptConfirmationLevel = 'None' | 'Standard' | 'Critical';

/**
 * Per-script client/group whitelist scope (same shape as AlertRuleScope).
 * `Workspace: true` OR a null/absent scope both mean "all clients" (the
 * unrestricted default). `Workspace: false` restricts to the listed groups
 * (by GroupID), tags (by TagID) and clients (by UUID); an empty list therefore
 * means "no clients may run this script".
 *
 * `Tags` is optional on the wire: rows written before tag support omit it and
 * an absent list means "no tags", never "all".
 */
export interface ScriptWhitelistScope {
  Workspace: boolean;
  Groups: number[];
  Clients: string[];
  Tags?: number[];
}

/**
 * A Script.json as the current Server normalises it (missing or invalid keys
 * repaired, legacy keys migrated), shipped whole as a valid entry's `Config`.
 * Keys the author added are kept as written.
 */
export interface ScriptConfig {
  Name: string;
  Description: string;
  /** Index into the shared eight-colour palette (0-7). */
  Colour: number;
  /** Bootstrap Icons name without the `bi-` prefix. */
  Icon: string;
  Weight: number;
  Confirmation: boolean;
  /** Written only for a Critical confirmation, so older readers see a plain confirmation. */
  ConfirmationStyle?: 'Critical';
  Enabled: boolean;
  /** Milliseconds, at least 5000. */
  Timeout: number;
  Platforms: ScriptPlatformMap;
  Arguments: ScriptPlatformMap;
  ConsoleFilter: ScriptConsoleFilter;
  [key: string]: unknown;
}

// ---- The current Server's catalog -------------------------------------------

/** Fields every entry of the current Server's catalog carries. */
interface ScriptCatalogEntryFields {
  /** The script's folder name: `^[A-Za-z0-9_-]+$`. */
  ID: string;
  Name: string;
  Description: string;
  Colour: number;
  Icon: string;
  Weight: number;
  /** True for both Standard and Critical; kept for readers that predate levels. */
  Confirmation: boolean;
  ConfirmationLevel: ScriptConfirmationLevel;
  Platforms: ScriptPlatformMap;
  Arguments: ScriptPlatformMap;
  /** The platforms whose launch file exists in the folder. */
  CompatiblePlatforms: string[];
  Files: ScriptFileEntry[];
  isEnabled: boolean;
  /** What normalising Script.json repaired; empty when nothing needed it. */
  ValidationErrors: string[];
  /**
   * The script's whitelist, or null when unrestricted. Present only on the
   * `SetScriptList` push (desktop, Web UI and `/sdk`), which decorates copies
   * of the catalog with it; never in the `GetScripts` acknowledgement, so the
   * catalog classes themselves do not carry it.
   */
  Whitelist?: ScriptWhitelistScope | null;
}

/** A runnable script: its Script.json parsed and normalised (the Server's `Script` class). */
export interface ScriptCatalogScript extends ScriptCatalogEntryFields {
  isValid: true;
  /** Milliseconds the client lets the script run before stopping it. */
  Timeout: number;
  ConsoleFilter: ScriptConsoleFilter;
  Config: ScriptConfig;
  /** Only an invalid script has these. */
  ParseError?: undefined;
  RawText?: undefined;
}

/**
 * A script whose Script.json could not be read or parsed (the Server's
 * `InvalidScript` class). Listed so the author can fix it in the Script
 * Manager; never runnable, never deployed.
 */
export interface ScriptCatalogInvalidScript extends ScriptCatalogEntryFields {
  isValid: false;
  /** Why it failed, e.g. "Invalid JSON: Unexpected token ...". */
  ParseError: string;
  /** The file as it is on disk (empty when it could not be read), for the editor. */
  RawText: string;
  Config: null;
  /** Only a valid script has these. */
  Timeout?: undefined;
  ConsoleFilter?: undefined;
}

/** An entry of the current Server's catalog. Narrow on `isValid`. */
export type ScriptCatalogEntry = ScriptCatalogScript | ScriptCatalogInvalidScript;

// ---- What any supported Server sends ----------------------------------------
//
// Fields were added over time; each one notes the Server release that started
// sending it. A field without a note has been sent since the generation began.

/**
 * A catalog entry from Server 3.0.0 - 3.2.x, before Script.json had a schema:
 * one launch `Path` (no per-platform map), a Bootstrap style name rather than
 * a colour index, and values copied from Script.json without validation (so
 * `Name`, `Type` and `Path` are absent when the file lacked them). A file
 * that failed to parse was left out of the catalog, so `isValid` is always true.
 *
 * Servers from 3.3.0 migrate a legacy `Path` into `Platforms` before sending,
 * so `Path` only ever arrives from these.
 */
export interface LegacyScriptCatalogEntry {
  ID: string;
  Name?: string;
  /** Script.json's free-form `Type`, unused by any client. */
  Type?: string;
  /** The one script file to launch, relative to the script folder, on every platform. */
  Path?: string;
  /** A Bootstrap style name ('light' when unset); later Servers send `Colour`. */
  LabelStyle: string;
  Weight: number;
  Confirmation: boolean;
  Files: ScriptFileEntry[];
  isEnabled: boolean;
  isValid: true;
  // Not in this generation. Declared so a reader can test for them on the union.
  Description?: undefined;
  Colour?: undefined;
  Icon?: undefined;
  ConfirmationLevel?: undefined;
  Timeout?: undefined;
  Platforms?: undefined;
  Arguments?: undefined;
  CompatiblePlatforms?: undefined;
  ConsoleFilter?: undefined;
  ValidationErrors?: undefined;
  Config?: undefined;
  ParseError?: undefined;
  RawText?: undefined;
}

/** Fields every entry from Server 3.3.0 on carries, with the release that added the later ones. */
interface ScriptCatalogWireFields {
  ID: string;
  Name: string;
  Description: string;
  Colour: number;
  /** Server 3.9.0+. Readers fall back to 'terminal'. */
  Icon?: string;
  Weight: number;
  Confirmation: boolean;
  /** Server 3.25.0+. Readers fall back to `Confirmation` ('Standard' or 'None'). */
  ConfirmationLevel?: ScriptConfirmationLevel;
  Platforms: ScriptPlatformMap;
  Arguments: ScriptPlatformMap;
  CompatiblePlatforms: string[];
  Files: ScriptFileEntry[];
  isEnabled: boolean;
  ValidationErrors: string[];
  // Legacy-only (Server 3.0.0 - 3.2.x). Declared so a reader can test for them on the union.
  Path?: undefined;
  Type?: undefined;
  LabelStyle?: undefined;
}

/** A runnable script from Server 3.3.0 on. */
export interface ScriptCatalogWireScript extends ScriptCatalogWireFields {
  isValid: true;
  /** Server 3.4.1+. Readers fall back to their default timeout (15 s). */
  Timeout?: number;
  /** Server 3.12.0+. Absent means no filter. */
  ConsoleFilter?: ScriptConsoleFilter;
  /** The normalised Script.json; which keys it has depends on the Server's release. */
  Config: Partial<ScriptConfig>;
  ParseError?: undefined;
  RawText?: undefined;
}

/** A script whose Script.json failed to parse, from Server 3.3.0 on. Never runnable. */
export interface ScriptCatalogWireInvalidScript extends ScriptCatalogWireFields {
  isValid: false;
  ParseError: string;
  RawText: string;
  Config: null;
  Timeout?: undefined;
  ConsoleFilter?: undefined;
}

/**
 * A `GetScripts` catalog entry as any supported Server sends it: the type a
 * client is written against. Narrow on `isValid` (only a 3.3.0+ Server sends
 * invalid entries) and on `Platforms` (absent only from a legacy Server, whose
 * entries carry a single `Path` instead).
 *
 * No Server has ever sent a top-level `Enabled`: every release sends
 * `isEnabled`, and Script.json's own `Enabled` key only appears inside
 * `Config` (3.3.0+).
 */
export type ScriptCatalogWireEntry =
  LegacyScriptCatalogEntry | ScriptCatalogWireScript | ScriptCatalogWireInvalidScript;

// ---- Execution results ------------------------------------------------------

/**
 * The third argument of a client's `ScriptExecutionResponse`: `true` when an
 * `ExecuteScript` run succeeded, `null` when it failed. Absent for every other
 * task (`UpdateSoftware`, `UpdateSoftwareFromLAN`, `DeleteScripts`,
 * `UpdateScripts`). Every Client release since 3.0.0 sends exactly this; the
 * Server reads only the error argument, where null means success.
 */
export type ScriptExecutionResult = true | null;

export {};
