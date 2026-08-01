// @showtrak/protocol — serialized entity / "view" shapes as they cross the
// renderer <-> main IPC boundary.
//
// Extracted from preload.d.ts so that file can be just the `window.API`
// contract. Field casing intentionally mirrors each producer (some handlers
// emit camelCase, some PascalCase — see per-type notes). Re-exported through
// the package barrel (index.d.ts), so consumers still `import type { ClientView }
// from '@showtrak/protocol'` unchanged.

import type {
  USBDevice,
  ClientDisplay,
  NetworkInterface,
  RunningApplicationItem,
  RunningApplicationsStatus,
} from './telemetry';
import type { Vitals } from './vitals';
import type { IntegratedAction } from './integrated';

/**
 * A user-marked critical USB device (the persisted "expected" association).
 * Emitted in `ClientView.CriticalUSBDevices`.
 */
export interface CriticalUSBDevice {
  SerialNumber: string;
  ManufacturerName: string | null;
  ProductName: string | null;
  Timestamp: number | null;
}

/**
 * A critical USB device that is currently NOT connected.
 * Emitted in `ClientView.MissingCriticalUSBDevices`.
 */
export interface MissingCriticalUSBDevice {
  ManufacturerName: string | null;
  ProductName: string | null;
  SerialNumber: string;
  IsConnected: false;
  IsCritical: true;
  Missing: true;
}

/**
 * A user-marked serial-less critical USB device, guarded by its visible name
 * (Manufacturer + Product) and an expected Quantity rather than a serial number.
 * Emitted in `ClientView.CriticalUSBNames`.
 */
export interface CriticalUSBName {
  NameKey: string;
  ManufacturerName: string | null;
  ProductName: string | null;
  Quantity: number;
  Timestamp: number | null;
}

/**
 * A serial-less critical USB device whose connected count currently falls short
 * of its expected Quantity. Emitted in `ClientView.MissingCriticalUSBNames`.
 */
export interface MissingCriticalUSBName {
  ManufacturerName: string | null;
  ProductName: string | null;
  SerialNumber: null;
  NameKey: string;
  Quantity: number;
  ConnectedCount: number;
  IsConnected: false;
  IsCritical: true;
  IsCriticalByName: true;
  Shortfall: true;
  Missing: true;
}

/**
 * A user-marked critical application.
 * Emitted in `ClientView.CriticalApplications`.
 */
export interface CriticalApplication {
  Name: string;
  Key: string;
  Timestamp: number | null;
}

/**
 * A critical application that is currently NOT running.
 * Emitted in `ClientView.MissingCriticalApplications`.
 */
export interface MissingCriticalApplication {
  Name: string;
  Count: number;
  Key: string;
  IsRunning: false;
  IsCritical: true;
  Missing: true;
}

/**
 * A user-marked critical display (the persisted "expected" configuration).
 * Emitted in `ClientView.CriticalDisplays`.
 */
export interface CriticalDisplay {
  DisplayID: string;
  Label: string | null;
  Width: number | null;
  Height: number | null;
  RefreshRate: number | null;
  ScaleFactor: number | null;
  Timestamp: number | null;
}

/**
 * A critical display that is currently NOT connected.
 * Emitted in `ClientView.MissingCriticalDisplays`.
 */
export interface MissingCriticalDisplay {
  DisplayID: string;
  Label: string | null;
  Width: number | null;
  Height: number | null;
  RefreshRate: number | null;
  ScaleFactor: number | null;
  IsConnected: false;
  IsCritical: true;
  Missing: true;
  Mismatch: false;
  CurrentSignature: null;
  ExpectedSignature: string;
}

/**
 * A connected display whose current configuration differs from its critical
 * baseline. Carries the full {@link ClientDisplay} plus the diff annotations.
 * Emitted in `ClientView.MismatchedCriticalDisplays`.
 */
export interface MismatchedCriticalDisplay extends ClientDisplay {
  IsConnected: true;
  IsCritical: boolean;
  Missing: false;
  Mismatch: boolean;
  CurrentSignature: string;
  ExpectedSignature: string | null;
}

/**
 * Telemetry list elements as *serialized* to the renderer: the raw wire shapes
 * enriched in-place by the Client class's critical-marking machinery.
 */
export interface USBDeviceView extends USBDevice {
  IsCritical?: boolean;
  IsConnected?: boolean;
  // Serial-less name-based guarding annotations (see CriticalUSBName).
  IsCriticalByName?: boolean;
  NameKey?: string;
  Quantity?: number;
  ConnectedCount?: number;
  Shortfall?: boolean;
  Missing?: boolean;
}

export interface ClientDisplayView extends ClientDisplay {
  IsCritical?: boolean;
}

export interface RunningApplicationViewItem extends RunningApplicationItem {
  Key?: string;
  IsCritical?: boolean;
  IsRunning?: boolean;
}

export interface RunningApplicationsView {
  SampledAt?: number;
  TotalCount?: number;
  Truncated?: boolean;
  Items: RunningApplicationViewItem[];
  Status?: RunningApplicationsStatus;
  NoChanges?: boolean;
}

/** Renderer-facing serialized client (superset across desktop + web surfaces). */
export interface ClientView {
  Type?: string;
  UUID: string;
  Nickname?: string | null;
  Hostname?: string | null;
  OperatingSystem?: string;
  GroupID?: number | null;
  Weight?: number;
  Version?: string | null;
  VersionLabel?: string;
  // Stable, human-friendly OSC/API identifier; unique across the shared client
  // namespace (real clients + monitors + dummies).
  Slug?: string | null;
  IP?: string | null;
  /** MAC of the interface serving the active socket IP — the currently-active
   *  address. One of MacAddresses below; kept as a convenience for display. */
  MacAddress?: string | null;
  /** Every MAC the client is known by. This, not MacAddress, is the full
   *  Wake-on-LAN target set. */
  MacAddresses?: ClientMacAddressView[];
  RunOnLaunchScriptID?: string | null;
  RunOnLaunchDelaySeconds?: number | null;
  Online?: boolean;
  LastSeen?: number;
  Vitals?: Vitals | null;
  USBDeviceList?: USBDeviceView[];
  CriticalUSBDevices?: CriticalUSBDevice[];
  CriticalUSBSerials?: string[];
  MissingCriticalUSBDevices?: MissingCriticalUSBDevice[];
  CriticalUSBNames?: CriticalUSBName[];
  MissingCriticalUSBNames?: MissingCriticalUSBName[];
  Degraded?: boolean;
  DegradedWarnings?: string[];
  /** Online, but inside its start-up window with a critical application, USB
   *  device or display still unaccounted for. The machine is booting, so the
   *  guard is held rather than reported as a fault: the tile reads "Starting
   *  Up" instead of degraded, and no alert fires until the window closes. */
  Initialising?: boolean;
  NetworkInterfaces?: NetworkInterface[];
  Integrated?: boolean;
  IntegratedActions?: IntegratedAction[];
  Identifying?: boolean;
  // Reserved slot with no hardware behind it yet; permanently offline until a
  // real device replaces it.
  Unassigned?: boolean;
  RunningApplications?: RunningApplicationsView;
  CriticalApplications?: CriticalApplication[];
  MissingCriticalApplications?: MissingCriticalApplication[];
  DisplayList?: ClientDisplayView[];
  CriticalDisplays?: CriticalDisplay[];
  CriticalDisplayIDs?: string[];
  MissingCriticalDisplays?: MissingCriticalDisplay[];
  MismatchedCriticalDisplays?: MismatchedCriticalDisplay[];
}

/** Renderer-facing group. */
export interface GroupView {
  GroupID: number;
  // The group entity stores `Data.Title || null`, so a group may serialize with
  // a null title; both surfaces copy it through verbatim.
  Title: string | null;
  Weight: number;
  // Emitted by both the web serializer (ToPublicGroup) and the desktop group
  // entity as `isFullWidth`. KeyBind is emitted by the desktop entity only.
  isFullWidth?: boolean;
  KeyBind?: string | null;
  // Stable, human-friendly OSC/API identifier; unique among groups.
  Slug?: string | null;
}

/**
 * Tag membership scope (same shape as ScriptWhitelistScope / AlertRuleScope).
 * `Workspace: true` means every client carries the tag; otherwise membership is
 * the union of the listed groups (by GroupID, dynamic — current AND future
 * members), tags (by TagID, dynamic — a tag can therefore be a superset of
 * other tags) and clients (by scoped ID: plain UUID, or `monitor:`/`check:`…).
 *
 * `Tags` is optional on the wire because rows written before tag-in-tag support
 * do not carry it; every normalizer emits it, and readers must treat an absent
 * list as empty rather than as "all".
 */
export interface TagScope {
  Workspace: boolean;
  Groups: number[];
  Clients: string[];
  Tags?: number[];
}

/**
 * How a tag draws itself on a client tile.
 *
 * `hidden` keeps the tag fully functional (membership, scripts, OSC, alert
 * scopes) while drawing nothing — the intended shape for tags that exist purely
 * to target machines rather than to label them on screen.
 *
 * The tile's badge row is a fixed height, so the modes differ only in what a
 * badge *contains*, never in how tall it is.
 */
export type TagDisplayMode = 'hidden' | 'icon' | 'name' | 'both';

/** Renderer-facing tag. Colour is an index into the shared Scripts palette. */
export interface TagView {
  TagID: number;
  // The slug doubles as the tag's display label; unique among tags. Back-filled
  // non-null on boot but typed nullable for pre-back-fill rows.
  Slug: string | null;
  Colour: number;
  Icon: string; // bare Bootstrap Icons name (no "bi-" prefix)
  // Tile badge presentation. Optional on the wire: rows/servers written before
  // this field existed omit it, and readers must fall back to 'name' (the
  // behaviour every tag had then) rather than treating it as hidden.
  Display?: TagDisplayMode;
  Scope: TagScope;
}

// ---------------------------------------------------------------------------
// Domain view types (serialized shapes as they cross the IPC boundary).
// Field casing intentionally mirrors each producer: some handlers emit
// camelCase, some PascalCase — see per-type notes.
// ---------------------------------------------------------------------------

// ---- Scripts --------------------------------------------------------------

/** `GetScriptManagerList` entry (camelCase; mapped in registrars/scripts.ts). */
export interface ScriptManagerEntry {
  id: string;
  name: string;
  description: string;
  colour: number;
  icon: string;
  weight: number;
  confirm: boolean;
  timeoutMs: number;
  enabled: boolean;
  valid: boolean;
  parseError: string | null;
  platforms: Record<string, string>;
  compatiblePlatforms: string[];
  issues: string[];
}

/**
 * Per-script client/group whitelist scope (same shape as AlertRuleScope).
 * `Workspace: true` OR a null/absent scope both mean "all clients" (the
 * unrestricted default). `Workspace: false` restricts to the listed groups
 * (by GroupID), tags (by TagID) and clients (by UUID); an empty list therefore
 * means "no clients may run this script".
 *
 * `Tags` is optional on the wire — rows written before tag support omit it and
 * an absent list means "no tags", never "all".
 */
export interface ScriptWhitelistScope {
  Workspace: boolean;
  Groups: number[];
  Clients: string[];
  Tags?: number[];
}

/** `GetScriptConfig` editable form (ScriptManager `GetEditable`). */
export interface ScriptEditable {
  id: string;
  name: string;
  description: string;
  colour: number;
  icon: string;
  confirm: boolean;
  timeoutMs: number;
  enabled: boolean;
  platforms: Record<string, string>;
  arguments: Record<string, string>;
  consoleFilter: ScriptConsoleFilter;
  files: string[];
  valid: boolean;
}

/**
 * Console filter applied CLIENT-SIDE while a script runs: only console lines
 * matching `Pattern` under `Mode` are surfaced as the live status tail. Mode
 * `none` (or an empty `Pattern`) disables filtering. When `Strip` is true the
 * matched text is removed from the surfaced line, leaving only the remainder.
 */
export interface ScriptConsoleFilter {
  Mode: 'none' | 'startsWith' | 'includes' | 'regex';
  Pattern: string;
  Strip: boolean;
}

export interface ScriptFileEntry {
  Path: string;
  Type: 'file' | 'directory';
  Checksum?: string | null;
}

/** `SetScriptList` push catalog entry (PascalCase; serialized Script class). */
export interface ScriptCatalogEntry {
  ID: string;
  Name: string;
  Description: string;
  Colour: number;
  Icon: string;
  Weight: number;
  Confirmation: boolean;
  Timeout?: number;
  Platforms: Record<string, string>;
  Arguments: Record<string, string>;
  CompatiblePlatforms: string[];
  ConsoleFilter?: ScriptConsoleFilter;
  isEnabled: boolean;
  isValid: boolean;
  ValidationErrors: string[];
  Config: Record<string, unknown> | null;
  Files: ScriptFileEntry[];
  ParseError?: string;
  RawText?: string;
  /**
   * Per-show whitelist scope. `null`/absent means unrestricted (all clients) —
   * the default. Attached to the catalog push from the ScriptWhitelistManager;
   * consumed by the context menu to hide the script for non-whitelisted clients.
   */
  Whitelist?: ScriptWhitelistScope | null;
}

export interface ScriptExecutionTimer {
  Start: number;
  End: number | null;
  Duration: number | null;
}

/** `UpdateScriptExecutions` push entry. */
export interface ScriptExecutionView {
  Internal: boolean;
  RequestID: string;
  Status: 'Pending' | 'Failed' | 'Completed';
  Progress: number;
  StatusText: string;
  Timer: ScriptExecutionTimer;
  Client: ClientView;
  Script: ScriptCatalogEntry | { ID: string; Name: string };
  Error?: string | null;
}

// ---- Monitoring -----------------------------------------------------------

/**
 * Conditional visibility: the field shows only while sibling `Key` matches.
 * Give either `Equals` (exact match) or `In` (membership) — `In` exists so a
 * field can be gated on "the operator is one of the ones that takes a value",
 * which equality alone cannot express.
 */
export interface MonitoringSettingVisibleWhen {
  Key: string;
  Equals?: unknown;
  In?: unknown[];
}

export interface MonitoringSettingField {
  Key: string;
  Label: string;
  /** 'string' (default) | 'number' | 'boolean' | 'select' | 'list'. */
  Type: string;
  Default?: unknown;
  Min?: number;
  Max?: number;
  Options?: Array<string | { value: string; label?: string }>;
  /** For Type 'list': how each entry is validated/coerced ('string' | 'number'). */
  ItemType?: 'string' | 'number';
  Advanced?: boolean;
  /** Marks a setting the check cannot run without; the editor shows a red asterisk. */
  Required?: boolean;
  /** Per-input hint shown as a hover popover on an info icon beside the input. */
  Note?: string;
  /**
   * When set, the field renders only while the referenced sibling setting equals
   * the value. An array is ANDed: every condition must hold. Use the array form
   * to gate a field behind both an "enable" toggle and a specific operator.
   */
  VisibleWhen?: MonitoringSettingVisibleWhen | MonitoringSettingVisibleWhen[];
}

export interface MonitoringMethodInfo {
  Summary: string;
  Setup?: string[];
  /** External references rendered as browser-opening buttons at the panel's foot. */
  Links?: Array<{ Label: string; Url: string }>;
}

export interface MonitoringMethodView {
  ID: string;
  Name: string;
  Description: string;
  Info?: MonitoringMethodInfo | null;
  // Grouping label for the editor's method picker (e.g. "Power (UPS)").
  Group: string;
  DefaultInterval: number;
  // True when the method uses the per-check Address field. When false, the editor
  // hides the Address input and does not require one. Defaults to true.
  UsesAddress: boolean;
  // True when the latency-based Degraded Threshold applies. When false, the editor
  // hides that Advanced field. Defaults to true.
  SupportsLatencyThreshold: boolean;
  Settings: MonitoringSettingField[];
}

export interface MonitoringCheckView {
  CheckID: number;
  TargetID: number;
  Name: string;
  Address: string;
  Method: string;
  Settings: Record<string, unknown>;
  DegradedThresholdMs: number;
  Weight: number;
  LastSuccessAt: number | null;
  Online: boolean;
  Degraded: boolean;
  LastChecked: number | null;
  LastLatencyMs: number | null;
  LastError: string | null;
}

export interface MonitoringTargetView {
  TargetID: number;
  Nickname: string;
  Interval: number;
  GroupID: number | null;
  Weight: number;
  // Stable, human-friendly OSC/API identifier; unique across the shared client
  // namespace. Nullable only in the window before first-boot back-fill.
  Slug: string | null;
  Timestamp: number;
  Address: string;
  Method: string;
  DegradedThresholdMs: number;
  LastSuccessAt: number | null;
  Online: boolean;
  Degraded: boolean;
  LastChecked: number | null;
  LastLatencyMs: number | null;
  LastError: string | null;
  CheckCount: number;
  Type: 'monitor';
  Checks: MonitoringCheckView[];
}

/** Uniform RAM-only history sample used across every history domain. */
export interface HistorySample {
  ts: number;
  online: boolean;
  degraded: boolean;
  latencyMs: number | null;
}

export interface MonitoringCheckDebug {
  CheckID: number;
  Method: string;
  Html: string | null;
  Online: boolean;
  Degraded: boolean;
  LastError: string | null;
  LastChecked: number | null;
  LastLatencyMs: number | null;
  LastDebugAt: number | null;
}

// ---- Dummy clients --------------------------------------------------------

export interface DummyClientView {
  UUID: string;
  DummyID: string;
  Nickname: string;
  Hostname: string;
  IP: string | null;
  Version: 'Dummy';
  Interval: number;
  GroupID: number | null;
  Weight: number;
  Timestamp: number;
  State: 'IDLE' | 'ONLINE' | 'DEGRADED' | 'OFFLINE';
  Online: boolean;
  Degraded: boolean;
  DegradedWarnings: string[];
  LastSeen: number | null;
  Type: 'dummy';
}

export interface DummyClientDefaults {
  DummyID: string;
  Nickname: string;
  Interval: number;
}

// ---- FreeKiosk terminals --------------------------------------------------

/** Which section of the view modal / editor accordion a metric belongs to. */
export type FreeKioskMetricSection =
  | 'Battery'
  | 'Screen'
  | 'Content'
  | 'Audio'
  | 'Device'
  | 'Network'
  | 'Rotation'
  | 'Sensors'
  | 'Storage'
  | 'Memory'
  | 'Poll';

export type FreeKioskMetricType = 'number' | 'boolean' | 'enum' | 'string';

/** How a metric's history is drawn: numeric line, categorical blocks, or not at all. */
export type FreeKioskChartKind = 'line' | 'blocks' | 'none';

/** How a metric's value is rendered for humans. */
export type FreeKioskMetricFormat = 'duration' | 'dbm' | 'url' | 'megabytes' | 'raw';

/**
 * Comparison a metric alarm can arm. `changes` and `decreases` are edge
 * detectors judged against the previous poll and take no threshold value.
 */
export type FreeKioskOperator =
  | 'below'
  | 'above'
  | 'outside'
  | 'inside'
  | 'is'
  | 'isNot'
  | 'contains'
  | 'notContains'
  | 'changes'
  | 'decreases';

/** One entry of the server-declared metric registry, as delivered to the renderer. */
/**
 * What a terminal is set up to show. Declared by the operator: FreeKiosk's API
 * cannot report it, and never clears the WebView readings when an external app
 * takes over.
 */
export type FreeKioskDisplayMode = 'webview' | 'external_app' | 'media_player';

export interface FreeKioskMetricView {
  Key: string;
  Label: string;
  Type: FreeKioskMetricType;
  Section: FreeKioskMetricSection;
  Chart: FreeKioskChartKind;
  /** Display modes this reading means anything in. Absent means all of them. */
  RequiresMode?: FreeKioskDisplayMode[];
  Unit?: string;
  Decimals?: number;
  Min?: number;
  Max?: number;
  Options?: string[];
  Operators: FreeKioskOperator[];
  DefaultOperator?: FreeKioskOperator;
  Format?: FreeKioskMetricFormat;
  Advanced?: boolean;
  Note?: string;
}

/**
 * The whole registry in one payload: the metrics themselves plus the generated
 * alarm settings schema, which the renderer feeds through the same field
 * renderer the monitoring editor uses.
 */
/**
 * A section monitoring can be switched off for wholesale, keyed `G_<Key>_On` in
 * a terminal's Settings. Switching one off hides its alarm toggles and charts,
 * stops its history, and force-disables any alarm armed inside it.
 */
export interface FreeKioskMetricGroupView {
  Key: FreeKioskMetricSection;
  Label: string;
  DefaultOn: boolean;
  /** No switch is offered; ShowTrak depends on it. */
  Fixed?: boolean;
  Note?: string;
}

export interface FreeKioskMetricCatalog {
  Metrics: FreeKioskMetricView[];
  AlarmFields: MonitoringSettingField[];
  Sections: FreeKioskMetricSection[];
  Groups: FreeKioskMetricGroupView[];
}

/** A control the UI may offer for a terminal. The server's map is the allowlist. */
export interface FreeKioskCommandDef {
  ID: string;
  Label: string;
  Icon: string;
  Group: 'Power' | 'Display' | 'Content' | 'Audio' | 'Maintenance';
  Params?: MonitoringSettingField[];
  /**
   * Display modes this command does anything in. Absent means all of them. The
   * device accepts an out-of-mode command and silently no-ops, so the server
   * refuses these rather than reporting a success that never happened.
   */
  Modes?: FreeKioskDisplayMode[];
  /** The device drops the connection carrying this out; that is success. */
  ExpectDisconnect?: boolean;
  /** Needs a confirmation dialog before running. */
  Destructive?: boolean;
  /** Offered in the multi-select context menu. */
  Bulk?: boolean;
  Control?: 'button' | 'slider';
  /** Registry metric this control writes, used to reconcile sliders after a poll. */
  Metric?: string;
  Note?: string;
}

/**
 * One point of a per-metric time series. `n` carries numeric metrics and `s`
 * categorical ones, so a single shape serves both chart kinds. `breach` records
 * the alarm verdict at sample time so chart shading can never drift from what
 * the alert engine actually decided.
 */
export interface FreeKioskMetricSample {
  ts: number;
  ok: boolean;
  n: number | null;
  s: string | null;
  breach: boolean;
}

export interface FreeKioskMetricSeries {
  MetricKey: string;
  Samples: FreeKioskMetricSample[];
}

/** A currently-breaching alarm, surfaced on the tile and in the view modal. */
export interface FreeKioskAlarmState {
  Key: string;
  Label: string;
  Value: string | number | boolean | null;
  Reason: string;
}

export interface FreeKioskTerminalView {
  UUID: string;
  /** Stable, human-friendly OSC/API identifier; unique across the shared client namespace. */
  Slug: string | null;
  Nickname: string;
  /** Device model once known, else the FreeKiosk default hostname. */
  Hostname: string;
  Address: string;
  Port: number;
  /** The API key itself is never broadcast — only whether one is configured. */
  HasApiKey: boolean;
  IP: string | null;
  Version: 'FreeKiosk';
  Interval: number;
  TimeoutMs: number;
  GroupID: number | null;
  Weight: number;
  Timestamp: number;
  /** Per-metric alarm configuration, keyed A_<MetricKey>_On / _Op / _V / _V2. */
  Settings: Record<string, unknown>;
  State: 'IDLE' | 'ONLINE' | 'DEGRADED' | 'OFFLINE';
  Online: boolean;
  Degraded: boolean;
  DegradedWarnings: string[];
  Alarms: FreeKioskAlarmState[];
  /** Latest reading per registry metric key; retained while offline so the modal is not blank. */
  Metrics: Record<string, string | number | boolean | null>;
  LastError: string | null;
  LastChecked: number | null;
  LastSuccessAt: number | null;
  LastLatencyMs: number | null;
  /** null until the first control attempt; false when the device has remote control disabled. */
  ControlEnabled: boolean | null;
  Type: 'freekiosk';
}

/**
 * What the editor reads: the broadcast view plus the stored API key.
 *
 * The key is left out of FreeKioskTerminalView because that shape is pushed to
 * every connected Web UI on every poll and JSON-stringified into alert history,
 * neither of which needs it. This shape is only ever returned in direct response
 * to opening the editor — the one place the key has to be shown, because it is
 * the form that edits it.
 */
export interface FreeKioskTerminalEditorView extends FreeKioskTerminalView {
  ApiKey: string | null;
}

export interface FreeKioskTerminalDefaults {
  Nickname: string;
  Address: string;
  Port: number;
  Interval: number;
  TimeoutMs: number;
  Settings: Record<string, unknown>;
}

export interface FreeKioskCameraInfo {
  id: string;
  facing: string;
  maxWidth: number;
  maxHeight: number;
}

/** An on-demand screenshot or camera capture. Never persisted, never broadcast. */
export interface FreeKioskCaptureResult {
  DataUrl: string;
  Bytes: number;
  Mime: string;
  CapturedAt: number;
}

export interface FreeKioskCommandOutcome {
  UUID: string;
  Success: boolean;
  Error: string | null;
}

/** Per-UUID results of a fanned-out command; one slow or refusing device never fails the batch. */
export interface FreeKioskCommandSummary {
  Total: number;
  Succeeded: number;
  Failed: number;
  Results: FreeKioskCommandOutcome[];
}

// ---- Alert rules ----------------------------------------------------------

/**
 * Which entities a rule watches. Same shape as TagScope / ScriptWhitelistScope:
 * the union of every group, tag and client listed (or everything, when
 * `Workspace` is true). `Tags` is optional — rules stored before tag support
 * omit it, and an absent list means "no tags".
 */
export interface AlertRuleScope {
  Workspace: boolean;
  Groups: unknown[];
  Clients: unknown[];
  Tags?: unknown[];
}

export interface AlertRuleActionView {
  Type: string;
  Settings: Record<string, unknown>;
  [key: string]: unknown;
}

export interface AlertRuleView {
  RuleID: number;
  Title: string;
  Scope: AlertRuleScope;
  /** One or more stimuli that fire this rule; the rule runs when ANY of them matches. */
  TriggerTypes: string[];
  TriggerConfig: Record<string, unknown>;
  Actions: AlertRuleActionView[];
  Enabled: boolean;
  Timestamp: number;
  UpdatedAt: number;
}

export interface AlertTriggerType {
  ID: string;
  Name: string;
}

export interface AlertActionSettingField {
  Key: string;
  Label: string;
  Type: string;
  Default?: unknown;
  Min?: number;
  Max?: number;
  Options?: unknown[];
  Source?: string;
  Preview?: string;
  Hidden?: boolean;
}

export interface AlertActionType {
  ID: string;
  Name: string;
  Description: string;
  Settings: AlertActionSettingField[];
}

export interface AlertTriggeredEvent {
  RuleID: number;
  RuleTitle: string;
  TriggerType: string;
  Context: Record<string, unknown>;
  Results: Array<{ Type: string; Success: boolean; Error: string | null }>;
  Timestamp: number;
}

export interface ShowTrakAlert {
  Title: string;
  Message: string;
  Severity: string;
  TriggerType: string | null;
  UUID: string | null;
}

// ---- Audio assets ---------------------------------------------------------

export interface AudioAssetView {
  ID: string;
  Label: string;
  OriginalName: string;
  Extension: string;
  Volume: number;
  Size: number;
  Duration: number | null;
  Timestamp: number;
  Missing: boolean;
}

export interface AudioAssetData {
  ID: string;
  Label: string;
  Volume: number;
  DataURL: string;
}

export interface AudioAssetInspection {
  Path: unknown;
  OriginalName: string;
  BaseLabel: string;
  Extension: string;
  Size: number;
  DataURL: string | null;
  Error: string | null;
}

// ---- FOG Project integration ----------------------------------------------

/**
 * Current state of the FOG integration. `Enabled` reflects the setting; `Healthy`
 * reflects whether the last probe of /fog/system/info actually succeeded. The UI
 * only treats FOG as available when both are true.
 */
export interface FogStatusView {
  Enabled: boolean;
  Healthy: boolean;
  /** Human-readable reason when unhealthy; null when healthy. */
  Message: string | null;
  /** Epoch ms of the last health probe, or null if never probed. */
  LastCheckedAt: number | null;
}

/** One MAC address a client is known by, as shown in the client editor. */
export interface ClientMacAddressView {
  /** Normalized upper-case colon-separated form, e.g. `AA:BB:CC:DD:EE:FF`. */
  MacAddress: string;
  /** How the address got here: observed in the client's own NIC report, or
   *  entered by an operator. Manual entries survive a client that never
   *  reports them; reported ones re-appear after deletion if still present. */
  Source: 'Reported' | 'Manual';
  /** Interface the address was observed on, when known. */
  InterfaceName: string | null;
  FirstSeen: number;
  LastSeen: number;
}

/** A host as reported by FOG, used to populate the client editor dropdown. */
export interface FogHostView {
  FogHostID: number;
  Name: string;
  /** Primary MAC, used to pre-select the likely match for a ShowTrak client. */
  MacAddress: string | null;
  /** Currently assigned image name, if any. Deploy fails without one. */
  ImageName: string | null;
}

/** A schedulable FOG task type that the operator has permitted in settings. */
export interface FogTaskTypeView {
  TaskTypeID: number;
  Name: string;
  Destructive: boolean;
  /** Type 13 (Single Snapin) needs a snapin ID supplied alongside it. */
  RequiresSnapinID: boolean;
}

/** A task ShowTrak scheduled, reconciled against FOG's active task list. */
export interface FogTaskView {
  FogTaskRecordID: number;
  UUID: string | null;
  /** Resolved ShowTrak client name, falling back to the FOG host name. */
  ClientName: string | null;
  FogHostID: number;
  FogHostName: string | null;
  /** Null until the poller matches this record to a live FOG task. */
  FogTaskID: number | null;
  TaskTypeID: number;
  TaskTypeName: string | null;
  /** True for Deploy/Capture types, which report a partclone percentage worth showing as a bar. */
  SupportsProgress: boolean;
  StateID: number;
  StateName: string;
  /** FOG reports progress as display text, not a number. */
  Percent: string | null;
  LastError: string | null;
  CreatedAt: number;
  UpdatedAt: number;
}

// ---- Settings / config ----------------------------------------------------

export interface SettingView {
  Group: string;
  Key: string;
  Title: string;
  Description: string;
  Type: 'BOOLEAN' | 'INTEGER' | 'STRING' | 'PASSWORD' | 'OPTION' | 'SLIDER';
  Value: boolean | number | string;
  isDefault: boolean;
  DefaultValue: boolean | number | string;
  OnUpdateEvent: string | null;
  Options: string[] | null;
  Min: number | null;
  Max: number | null;
  Unit: string | null;
}

export interface SettingGroupView {
  Name: string;
  Title: string;
}

export interface AppConfig {
  Application: { Version: string; Name: string; Port: number; IsPackaged: boolean };
  Shared: { Version: string };
}

export interface WebUIAddresses {
  port: number;
  hostname: string;
  urls: Array<{ host: string; url: string }>;
}

// ---- ShowTrak Remote ------------------------------------------------------

/**
 * A phone or tablet paired to this server through the `/sdk` control API.
 *
 * Deliberately carries neither the device token nor its hash: this shape exists
 * to be rendered in a settings list, and the token is returned exactly once, to
 * the device, at pairing.
 */
export interface RemoteDeviceView {
  DeviceID: string;
  DeviceName: string;
  /** 'ios' | 'android' when the device declared one it recognises, else null. */
  Platform: string | null;
  PairedAt: number;
  /** Null until the device's first reconnect after pairing. */
  LastSeenAt: number | null;
}

/**
 * A single-use pairing code, for display as a QR. Short-lived by design — it is
 * shown on a screen anyone in the room can see.
 */
export interface RemotePairingCode {
  Code: string;
  ExpiresAt: number;
}

// ---- Update manager -------------------------------------------------------

export interface UpdateManagerStatus {
  Ready: boolean;
  ReleaseVersion: string | null;
  ReleasedAt: string | null;
  DownloadedAt: string | null;
  Assets: Array<{ name: string; size: number; url: string }>;
  FeedPath: string;
}

export interface UpdateReleaseOption {
  tag: string;
  name: string;
  publishedAt: string | null;
  prerelease: boolean;
}

export interface UpdateDownloadProgress {
  percent: number;
  phase: string;
  message: string;
}

export interface UpdateDownloadResult {
  ReleaseVersion: string;
  FeedPath: string;
  AssetCount: number;
}

export interface UpdateDeployResult {
  ReleaseVersion: string;
  TargetCount: number;
  SelectedCount: number;
  TotalClientCount: number;
  FeedPath: string;
}

/** Application self-update lifecycle status (`OnAppUpdateStatus`). */
export interface AppUpdateStatus {
  state?: string;
  info?: { version?: string; tag?: string; notes?: string; [key: string]: unknown } | null;
  percent?: number;
  simulated?: boolean;
  error?: string;
}

// ---- Network discovery ----------------------------------------------------

export interface NetworkScanResult {
  Key?: string;
  Name: string;
  Hostname?: string | null;
  Address: string;
  Source: 'bonjour' | 'probe' | 'pjlink';
  ServiceType?: string;
  Port: number | null;
  TXT?: Record<string, unknown> | null;
  MethodHint: 'http' | 'ping' | 'pjlink';
}

export type NetworkScanEvent =
  | {
      ScanID: string;
      Type: 'status';
      Status: 'starting' | 'scanning' | 'error';
      Message?: string;
      Progress?: { Current: number; Total: number; Percent: number };
    }
  | { ScanID: string; Type: 'result'; Result: NetworkScanResult }
  | { ScanID: string; Type: 'done'; Status: 'completed' | 'cancelled'; Count: number };

// ---- OSC ------------------------------------------------------------------

export interface OSCRoute {
  Title: string;
  Path: string;
}

export type OSCBulkActionType =
  | 'WOL'
  | 'ExecuteScript'
  | 'InternalScript'
  // SDK control API types. The modal ones are desktop-only (suppressed on the
  // web push); the view ones apply to whichever renderer receives them.
  | 'OpenClientModal'
  | 'CloseModals'
  | 'SetCompactView'
  | 'ToggleCompactView';

export interface DebugTrafficEntry {
  protocol: 'osc';
  timestamp: number;
  valid: boolean;
  summary: string;
  detail: string;
  source?: string | null;
}

// ---- Client history -------------------------------------------------------

export interface ClientApplicationHistorySeries {
  Key: string;
  Name: string;
  samples: HistorySample[];
}

export interface ClientUSBHistorySeries {
  Serial: string;
  Name: string;
  samples: HistorySample[];
}

export interface ClientDisplayHistorySeries {
  DisplayID: string;
  Name: string;
  samples: HistorySample[];
}
