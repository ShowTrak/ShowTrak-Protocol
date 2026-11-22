// The script catalog on the client wire (src/scripts.d.ts, src/events.d.ts).

import type {
  ClientToServerEvents,
  LegacyScriptCatalogEntry,
  ScriptCatalogEntry,
  ScriptCatalogInvalidScript,
  ScriptCatalogScript,
  ScriptCatalogWireEntry,
  ScriptCatalogWireInvalidScript,
  ScriptCatalogWireScript,
  ScriptConfig,
  ScriptConfirmationLevel,
  ScriptConsoleFilter,
  ScriptExecutionResult,
  ScriptExecutionView,
  ScriptFileEntry,
  ScriptPlatformMap,
} from '@showtrak/protocol';
import type { Equal, Expect, Extends, HasKey } from './helpers';

// ---- The acknowledgement and the response carry the catalog types -----------

type GetScriptsAck = Parameters<Parameters<ClientToServerEvents['GetScripts']>[0]>[0];
export type _GetScriptsAck = Expect<Equal<GetScriptsAck, ScriptCatalogWireEntry[]>>;

type ResponseResult = Parameters<ClientToServerEvents['ScriptExecutionResponse']>[2];
export type _ResponseResult = Expect<Equal<ResponseResult, ScriptExecutionResult | undefined>>;
export type _ResultValues = Expect<Equal<ScriptExecutionResult, boolean | null>>;

// ---- Narrowing on isValid -----------------------------------------------------

export type _WireValid = Expect<
  Equal<
    Extract<ScriptCatalogWireEntry, { isValid: true }>,
    LegacyScriptCatalogEntry | ScriptCatalogWireScript
  >
>;
export type _WireInvalid = Expect<
  Equal<Extract<ScriptCatalogWireEntry, { isValid: false }>, ScriptCatalogWireInvalidScript>
>;
export type _CurrentValid = Expect<
  Equal<Extract<ScriptCatalogEntry, { isValid: true }>, ScriptCatalogScript>
>;
export type _CurrentInvalid = Expect<
  Equal<Extract<ScriptCatalogEntry, { isValid: false }>, ScriptCatalogInvalidScript>
>;

/** How a client reads an entry: every access below must compile on the plain union. */
export function DescribeEntry(Entry: ScriptCatalogWireEntry, Platform: string): string {
  // Fields present in only some generations can be read without narrowing.
  const Timeout: number | undefined = Entry.Timeout;
  const Filter: ScriptConsoleFilter | undefined = Entry.ConsoleFilter;
  const Launch: string | undefined = Entry.Platforms?.[Platform] || Entry.Path;
  void [Timeout, Filter, Launch];

  if (Entry.isValid === false) {
    const Narrowed: ScriptCatalogWireInvalidScript = Entry;
    const Reason: string = Entry.ParseError;
    const Config: null = Entry.Config;
    void [Narrowed, Config];
    return Reason;
  }
  // Only a legacy (3.0.0 - 3.2.x) Server leaves out Platforms.
  if (Entry.Platforms === undefined) {
    const Legacy: LegacyScriptCatalogEntry = Entry;
    return Legacy.Path ?? '';
  }
  const Modern: ScriptCatalogWireScript = Entry;
  return Modern.Platforms[Platform] ?? '';
}

export function DescribeCurrent(Entry: ScriptCatalogEntry): string {
  if (!Entry.isValid) return `${Entry.ID}: ${Entry.ParseError}`;
  const Timeout: number = Entry.Timeout;
  const Config: ScriptConfig = Entry.Config;
  return `${Entry.ID}: ${Timeout} ms, ${Config.Name}`;
}

// ---- Legacy fields ----------------------------------------------------------------

export type _LegacyPath = Expect<Equal<LegacyScriptCatalogEntry['Path'], string | undefined>>;
export type _LegacyStyle = Expect<Equal<LegacyScriptCatalogEntry['LabelStyle'], string>>;
export type _LegacyName = Expect<Equal<LegacyScriptCatalogEntry['Name'], string | undefined>>;
export type _LegacyAlwaysValid = Expect<Equal<LegacyScriptCatalogEntry['isValid'], true>>;
// Fields later Servers added are optional on the wire...
export type _WireIcon = Expect<Equal<ScriptCatalogWireScript['Icon'], string | undefined>>;
export type _WireLevel = Expect<
  Equal<ScriptCatalogWireScript['ConfirmationLevel'], ScriptConfirmationLevel | undefined>
>;
export type _WireTimeout = Expect<Equal<ScriptCatalogWireScript['Timeout'], number | undefined>>;
// ...and required in the current Server's catalog.
export type _CurrentIcon = Expect<Equal<ScriptCatalogScript['Icon'], string>>;
export type _CurrentLevel = Expect<
  Equal<ScriptCatalogScript['ConfirmationLevel'], ScriptConfirmationLevel>
>;
// No Server ever sent a top-level Enabled, so no generation declares one.
export type _NoTopLevelEnabled = Expect<Equal<HasKey<ScriptCatalogWireEntry, 'Enabled'>, false>>;

// ---- The two layers fit together ---------------------------------------------------

// What the current Server sends is something a client already accepts.
export type _CurrentIsWire = Expect<Extends<ScriptCatalogEntry[], GetScriptsAck>>;
// But an older Server's entry is not a current one: a client cannot assume it.
export type _LegacyIsNotCurrent = Expect<
  Equal<Extends<LegacyScriptCatalogEntry, ScriptCatalogEntry>, false>
>;
export type _OldModernIsNotCurrent = Expect<
  Equal<Extends<ScriptCatalogWireScript, ScriptCatalogScript>, false>
>;
// The execution list carries only the script's ID and name, never the catalog entry.
export type _ExecutionScript = Expect<
  Equal<ScriptExecutionView['Script'], { ID: string; Name: string }>
>;

// ---- The Server's catalog classes can implement the current shapes ----------------

// Mirrors ShowTrak Server's Script class (src/Modules/ScriptManager): a class
// declaring exactly these fields satisfies the interface.
export declare class Script implements ScriptCatalogScript {
  ID: string;
  Name: string;
  Description: string;
  Colour: number;
  Icon: string;
  Weight: number;
  Confirmation: boolean;
  ConfirmationLevel: ScriptConfirmationLevel;
  Timeout: number;
  Platforms: ScriptPlatformMap;
  Arguments: ScriptPlatformMap;
  ConsoleFilter: ScriptConsoleFilter;
  CompatiblePlatforms: string[];
  Files: ScriptFileEntry[];
  isEnabled: boolean;
  isValid: true;
  ValidationErrors: string[];
  Config: ScriptConfig;
}

// Mirrors its InvalidScript class.
export declare class InvalidScript implements ScriptCatalogInvalidScript {
  ID: string;
  Name: string;
  Description: string;
  Colour: number;
  Icon: string;
  Weight: number;
  Confirmation: boolean;
  ConfirmationLevel: ScriptConfirmationLevel;
  Platforms: ScriptPlatformMap;
  Arguments: ScriptPlatformMap;
  CompatiblePlatforms: string[];
  Files: ScriptFileEntry[];
  isEnabled: boolean;
  isValid: false;
  ParseError: string;
  RawText: string;
  ValidationErrors: string[];
  Config: null;
}

export type _ClassesAreCatalog = Expect<Extends<Script | InvalidScript, ScriptCatalogEntry>>;
