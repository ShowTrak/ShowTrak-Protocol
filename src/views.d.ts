// @showtrak/protocol: serialized entity / "view" shapes as they cross the
// renderer <-> main IPC boundary.
//
// Extracted from preload.d.ts so that file can be just the `window.API`
// contract. Field casing intentionally mirrors each producer (some handlers
// emit camelCase, some PascalCase; see per-type notes). Re-exported through
// the package barrel (index.d.ts), so consumers still `import type { ClientView }
// from '@showtrak/protocol'` unchanged.

import type {
  USBDevice,
  ClientDisplay,
  NetworkInterface,
  RunningApplicationItem,
  RunningApplicationsStatus,
  AudioCapabilities,
  AudioDirection,
  AudioEndpoint,
  AudioMonitorStatus,
  NetworkInterfaceAddress,
  CollectorStatus,
  PowerStatusSnapshot,
  RunningApplicationsCapabilities,
  StorageVolume,
  TemperaturesSnapshot,
  ThermalState,
} from './telemetry';
import type { Vitals } from './vitals';
import type { IntegratedAction } from './integrated';

/**
 * The conditions a critical USB device (by serial or by name) must keep. A
 * guarded value is null when it is not guarded.
 */
export interface CriticalUSBConditions {
  /** Fault when it is not connected (by name: fewer than `Quantity` connected). */
  RequirePresent: boolean;
  /**
   * The port it must be plugged into (`USBDevice.Location`). By name: the ports
   * the group occupies, comma-separated, and none of its devices may sit elsewhere.
   */
  Location: string | null;
  /** The firmware it must report (`USBDevice.FirmwareVersion`). */
  FirmwareVersion: string | null;
  /** Fault when Windows reports a device problem. Never judged where it is not reported. */
  RequireNoError: boolean;
}

/**
 * A user-marked critical USB device (the persisted "expected" association).
 * Emitted in `ClientView.CriticalUSBDevices`.
 */
export interface CriticalUSBDevice extends CriticalUSBConditions {
  SerialNumber: string;
  ManufacturerName: string | null;
  ProductName: string | null;
  Timestamp: number | null;
}

/** Why a critical USB device is not in its expected state. */
export type USBIssueKind = 'missing' | 'location' | 'firmware' | 'device_error';

export interface USBIssue {
  Kind: USBIssueKind;
  /** Operator-facing sentence, e.g. "Plugged into Bus 1 · Port 3 (expected Bus 1 · Port 2.4)". */
  Message: string;
}

/**
 * What a client's USB reports can say beyond the devices themselves: whether it
 * reports each property at all. A client before 3.21.0 reports none of them.
 */
export interface USBCapabilities {
  Location: boolean;
  FirmwareVersion: boolean;
  /** Windows clients only. */
  DeviceState: boolean;
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
export interface CriticalUSBName extends CriticalUSBConditions {
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
  /**
   * Fault when another application holds the focused window. Only judged on
   * a client that can report the foreground application. Absent on rows
   * written before this condition existed, which read as false.
   */
  RequireForeground?: boolean;
  /**
   * Fault when its windows stop answering the operating system. Only judged on
   * a client that can detect hung applications. Absent reads as true.
   */
  RequireResponding?: boolean;
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
  RequireForeground?: boolean;
  RequireResponding?: boolean;
}

/**
 * A user-marked critical display: the baseline captured when it was marked, and
 * the conditions it must keep. Emitted in `ClientView.CriticalDisplays`.
 *
 * `DisplayID` is the identity it was marked under (see `ClientDisplay.DisplayID`);
 * the server still recognises the display when the client later reports it under
 * a different tier of identity, so a critical display is matched rather than
 * looked up. Each guarded property is null when it is not guarded; `Width` and
 * `Height` are set together, and so are `PositionX` and `PositionY`.
 */
export interface CriticalDisplay {
  DisplayID: string;
  Label: string | null;
  /** Fault when the display is not connected. */
  RequirePresent: boolean;
  /** Resolution in physical pixels: `ClientDisplay.Width`/`Height` × `ScaleFactor`. */
  Width: number | null;
  Height: number | null;
  /** Whole hertz. */
  RefreshRate: number | null;
  ScaleFactor: number | null;
  /** Degrees: 0, 90, 180 or 270. */
  Rotation: number | null;
  /** Fault when another display is the primary one. */
  RequirePrimary: boolean;
  /** Top-left corner in the desktop arrangement (`ClientDisplay.Bounds.x`/`y`). */
  PositionX: number | null;
  PositionY: number | null;
  Timestamp: number | null;
}

/** Why a critical display is not in its expected state. */
export type DisplayIssueKind =
  'missing' | 'resolution' | 'refresh_rate' | 'scale' | 'rotation' | 'primary' | 'position';

export interface DisplayIssue {
  Kind: DisplayIssueKind;
  /** Operator-facing sentence, e.g. "Refresh rate is 30 Hz (expected 60 Hz)". */
  Message: string;
}

/**
 * A critical display that is currently NOT connected and is required to be.
 * Emitted in `ClientView.MissingCriticalDisplays`.
 */
export interface MissingCriticalDisplay {
  DisplayID: string;
  Label: string | null;
  Width: number | null;
  Height: number | null;
  RefreshRate: number | null;
  ScaleFactor: number | null;
  Rotation: number | null;
  IsConnected: false;
  IsCritical: true;
  Missing: true;
  Mismatch: false;
  Issues: DisplayIssue[];
  Critical: CriticalDisplay;
  CurrentSignature: null;
  ExpectedSignature: string;
}

/**
 * A connected critical display breaking one or more of its conditions. Carries
 * the full {@link ClientDisplay} plus the judgement.
 * Emitted in `ClientView.MismatchedCriticalDisplays`.
 */
export interface MismatchedCriticalDisplay extends ClientDisplay {
  IsConnected: true;
  IsCritical: boolean;
  Missing: false;
  Mismatch: boolean;
  Issues: DisplayIssue[];
  Critical: CriticalDisplay | null;
  CurrentSignature: string;
  ExpectedSignature: string | null;
}

/**
 * A user-marked critical audio endpoint: the persisted baseline, and the
 * conditions it must keep. Emitted in `ClientView.CriticalAudioDevices`.
 *
 * `Channels` / `SampleRate` are captured from the live endpoint when it is
 * marked; null means that property is not guarded. `MinVolume` / `MaxVolume`
 * bound the level (0-100); null leaves that side open.
 */
export interface CriticalAudioDevice {
  EndpointID: string;
  Direction: AudioDirection;
  Name: string;
  Channels: number | null;
  SampleRate: number | null;
  RequireDefault: boolean;
  RequireUnmuted: boolean;
  MinVolume: number | null;
  MaxVolume: number | null;
  Timestamp: number | null;
}

/** Why a critical audio endpoint is not in its expected state. */
export type AudioIssueKind =
  'missing' | 'not_default' | 'channels' | 'sample_rate' | 'muted' | 'volume';

export interface AudioIssue {
  Kind: AudioIssueKind;
  /** Operator-facing sentence, e.g. "Sample rate is 44.1 kHz (expected 48 kHz)". */
  Message: string;
}

/**
 * An audio endpoint as serialized to the renderer: either one the client
 * reported (`IsConnected`), or a critical one it did not (`Missing`), which then
 * carries its baseline values and nulls for everything only a live device has.
 */
export interface AudioEndpointView extends AudioEndpoint {
  IsConnected: boolean;
  IsCritical: boolean;
  Missing: boolean;
  /** Empty for a healthy or non-critical endpoint. */
  Issues: AudioIssue[];
  Critical: CriticalAudioDevice | null;
}

/** `ClientView.AudioDevices`: everything the server knows about a client's audio. */
export interface AudioDevicesView {
  /** Null until this connection has reported audio at all. */
  SampledAt: number | null;
  Status: AudioMonitorStatus;
  /** Null until the first report; the renderer then cannot yet say what is unavailable. */
  Capabilities: AudioCapabilities | null;
  Endpoints: AudioEndpointView[];
}

/**
 * A user-marked critical network interface, keyed by interface name, and the
 * conditions it must keep. Emitted in `ClientView.CriticalNetworkInterfaces`.
 *
 * Every address condition is null when it is not guarded. `RangeStart` and
 * `RangeEnd` are set together or not at all.
 */
export interface CriticalNetworkInterface {
  Name: string;
  /** The MAC it had when marked, for display; not a condition. */
  MAC: string | null;
  /**
   * The address family it is monitored under: which list it lives in, and the
   * family a first mark captured its address from. Null on entries saved before
   * it was recorded; those take it from the address they guard.
   */
  Family: 'IPv4' | 'IPv6' | null;
  /** Fault when the interface is not reported (cable out, adapter gone). */
  RequirePresent: boolean;
  /** The interface must carry exactly this address. */
  Address: string | null;
  /** The interface must carry an address inside this inclusive range. */
  RangeStart: string | null;
  RangeEnd: string | null;
  /** An address of this family must have this subnet mask. */
  Netmask: string | null;
  /** The interface's default gateway must be this router. */
  Gateway: string | null;
  Timestamp: number | null;
}

/** Why a critical network interface is not in its expected state. */
export type NetworkIssueKind = 'missing' | 'address' | 'range' | 'netmask' | 'gateway';

export interface NetworkIssue {
  Kind: NetworkIssueKind;
  /** Operator-facing sentence, e.g. "Subnet mask is 255.255.0.0 (expected 255.255.255.0)". */
  Message: string;
}

/**
 * A network interface as serialized to the renderer: one the client reported
 * (`IsConnected`), or a critical one it did not (`Missing`), which then carries
 * an empty address list.
 */
export interface NetworkInterfaceView {
  Name: string;
  MAC: string | null;
  /** Loopback and the like. Never offered for critical monitoring. */
  Internal: boolean;
  Addresses: NetworkInterfaceAddress[];
  /** Null when there is none, or when `Capabilities.Router` says it cannot be read. */
  Gateway: string | null;
  IsConnected: boolean;
  IsCritical: boolean;
  Missing: boolean;
  /** Empty for a healthy or non-critical interface. */
  Issues: NetworkIssue[];
  Critical: CriticalNetworkInterface | null;
}

/** What the client's network report can say beyond the interfaces themselves. */
export interface NetworkCapabilities {
  /** Whether the client reports each interface's router. */
  Router: boolean;
}

/** `ClientView.NetworkStatus`: the interfaces judged against their critical baselines. */
export interface NetworkStatusView {
  /** Null until this connection has reported its interfaces. */
  SampledAt: number | null;
  Capabilities: NetworkCapabilities | null;
  Interfaces: NetworkInterfaceView[];
}

/**
 * A user-monitored storage volume, keyed by mount point, and the conditions it
 * must keep. Emitted in `ClientView.CriticalStorageVolumes`.
 *
 * Free space is guarded as a share of the volume, as an amount, or both; a null
 * limit is not guarded. Sizes are in GB of 1024³ bytes, as the cards show them.
 */
export interface CriticalStorageVolume {
  MountPoint: string;
  /** The volume's label when it was monitored, to name it while it is missing. */
  Name: string | null;
  /** Always true: a monitored volume must stay mounted. */
  RequirePresent: boolean;
  /** Free space, 1-99% of the volume, BELOW which the volume is in fault. */
  MinFreePercent: number | null;
  /** Free space, in whole GB, BELOW which the volume is in fault. */
  MinFreeGB: number | null;
  /** Fault while the volume is mounted read-only. */
  RequireWritable: boolean;
  /** Fault while the drive reports a health warning or failure. */
  RequireHealthy: boolean;
  Timestamp: number | null;
}

/** Why a monitored storage volume is not in its expected state. */
export type StorageIssueKind = 'missing' | 'free_percent' | 'free_space' | 'read_only' | 'health';

export interface StorageIssue {
  Kind: StorageIssueKind;
  /** Operator-facing sentence, e.g. "6% free (minimum 10%)". */
  Message: string;
}

/**
 * A volume as serialized to the renderer: one the client reported
 * (`IsConnected`), or a monitored one it did not (`Missing`), which then carries
 * its label and zeros for everything only a mounted volume has.
 */
export interface StorageVolumeView extends StorageVolume {
  IsConnected: boolean;
  IsCritical: boolean;
  Missing: boolean;
  /** Empty for a healthy or unmonitored volume. */
  Issues: StorageIssue[];
  Critical: CriticalStorageVolume | null;
}

/** `ClientView.StorageStatus`: the volumes judged against their monitored conditions. */
export interface StorageStatusView {
  /** Null until this connection has reported its volumes. */
  SampledAt: number | null;
  /** Null until the client has reported (an older client never does). */
  Status: CollectorStatus | null;
  Volumes: StorageVolumeView[];
}

/**
 * Telemetry list elements as *serialized* to the renderer: the raw wire shapes
 * enriched in-place by the Client class's critical-marking machinery.
 */
export interface USBDeviceView extends USBDevice {
  IsCritical?: boolean;
  IsConnected?: boolean;
  /** Connected and critical, but breaking a condition other than presence. */
  Mismatch?: boolean;
  /** Empty for a healthy or non-critical device. */
  Issues?: USBIssue[];
  /** The critical entry (by serial or by name) this device is guarded by. */
  Critical?: CriticalUSBDevice | CriticalUSBName | null;
  // Serial-less name-based guarding annotations (see CriticalUSBName).
  IsCriticalByName?: boolean;
  NameKey?: string;
  Quantity?: number;
  ConnectedCount?: number;
  Shortfall?: boolean;
  Missing?: boolean;
}

/**
 * A display as serialized to the renderer in `ClientView.DisplayList`: one the
 * client reported (`IsConnected`), or a critical one it did not, which then
 * carries its baseline values and none of the live-only fields.
 */
export interface ClientDisplayView extends ClientDisplay {
  IsCritical?: boolean;
  IsConnected?: boolean;
  /** Critical, required to be connected, and not reported on a connection that has reported its displays. */
  Missing?: boolean;
  /** Connected and critical, but breaking a condition. */
  Mismatch?: boolean;
  /** Empty for a healthy or non-critical display. */
  Issues?: DisplayIssue[];
  /** The critical entry this display was matched to. Its `DisplayID` may differ from the display's own. */
  Critical?: CriticalDisplay | null;
  /** "WIDTHxHEIGHT@HZ" in physical pixels, kept for older consumers; `Issues` is the judgement. */
  CurrentSignature?: string | null;
  ExpectedSignature?: string | null;
}

export interface RunningApplicationViewItem extends RunningApplicationItem {
  Key?: string;
  IsCritical?: boolean;
  IsRunning?: boolean;
  /** Owns the focused window. Only ever true where the client reports it. */
  IsForeground?: boolean;
  /** Monitored and required to hold the foreground (see CriticalApplication). */
  RequireForeground?: boolean;
  /** Monitored and required to respond (see CriticalApplication). */
  RequireResponding?: boolean;
}

export interface RunningApplicationsView {
  SampledAt?: number;
  TotalCount?: number;
  Truncated?: boolean;
  Items: RunningApplicationViewItem[];
  Status?: RunningApplicationsStatus;
  NoChanges?: boolean;
  /** Absent when the client cannot report it; see RunningApplicationsSnapshot. */
  Foreground?: string | null;
  /** Absent for clients that predate hung and foreground detection. */
  Capabilities?: RunningApplicationsCapabilities | null;
}

/**
 * The machine-wide checks a client can be monitored on, one card each in the
 * view modal. Every one is opt-in per client, exactly like a monitored display:
 * nothing is judged until an operator monitors it.
 */
export type ClientSystemCheckKey = 'cpu' | 'ram' | 'uptime' | 'power' | 'thermal';

/** CPU or memory usage. */
export interface ClientUsageCheck {
  /** Usage, 0-100, ABOVE which the client is in alarm. Null = not guarded. */
  MaxPercent: number | null;
  /**
   * How long usage must stay over the limit before the alarm is raised, and
   * back under it before the alarm clears. Spikes shorter than this are ignored.
   */
  SustainSeconds: number;
}

/** Time since the operating system last booted. */
export interface ClientUptimeCheck {
  /** Days of uptime ABOVE which the client is in alarm (a restart is due). Null = not guarded. */
  MaxDays: number | null;
}

/** Mains, battery charge and charging. */
export interface ClientPowerCheck {
  /** Fault while the machine runs from its battery. */
  RequireMains: boolean;
  /** Battery charge, 0-100, BELOW which the client is in alarm while not charging. Null = not guarded. */
  MinBatteryPercent: number | null;
  /**
   * Fault when the battery is not charging while its charge is BELOW this.
   * A battery that is full (or held at a level by the operating system's
   * battery-care charging) reports "not charging", so this is a level rather
   * than a yes/no. Null = not guarded.
   */
  ChargingBelowPercent: number | null;
}

/** Temperature sensors and the operating system's thermal verdict. */
export interface ClientThermalCheck {
  /** Hottest sensor, in °C, ABOVE which the client is in alarm. Null = not guarded. */
  MaxCelsius: number | null;
  /**
   * The highest thermal state still acceptable; anything beyond it is a fault.
   * 'fair' tolerates mild pressure and alarms once the machine throttles.
   * Only macOS reports a thermal state. Null = not guarded.
   */
  MaxThermalState: Exclude<ThermalState, 'critical'> | null;
}

/** A client's monitored system checks. A null check is not monitored. */
export interface ClientSystemChecks {
  Cpu: ClientUsageCheck | null;
  Ram: ClientUsageCheck | null;
  Uptime: ClientUptimeCheck | null;
  Power: ClientPowerCheck | null;
  Thermal: ClientThermalCheck | null;
}

/** One condition of a monitored system check that can be in alarm. */
export type ClientResourceAlarmKey =
  'cpu' | 'ram' | 'uptime' | 'power' | 'battery' | 'charging' | 'temperature' | 'thermal';

/** A system-check condition the client is currently failing. */
export interface ClientResourceAlarm {
  Key: ClientResourceAlarmKey;
  /**
   * The reading that raised (or most recently sustained) the alarm: a
   * percentage, hours of uptime, °C, or a thermal state. Null when unknown.
   */
  Value: number | string | null;
  /** The limit it broke, in the same unit. Null for a yes/no condition (mains). */
  Threshold: number | string | null;
  /** When the alarm was raised (ms since epoch). */
  Since: number;
}

/** CPU and memory usage over the history window, for the view modal's charts. */
export interface ClientVitalsHistory {
  Cpu: FreeKioskMetricSample[];
  Ram: FreeKioskMetricSample[];
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
  /** MAC of the interface serving the active socket IP: the currently-active
   *  address. One of MacAddresses below; kept as a convenience for display. */
  MacAddress?: string | null;
  /** Every MAC the client is known by. This, not MacAddress, is the full
   *  Wake-on-LAN target set. */
  MacAddresses?: ClientMacAddressView[];
  RunOnLaunchScriptID?: string | null;
  RunOnLaunchDelaySeconds?: number | null;
  /** Seconds a disconnect is tolerated before the client reads offline; null
   *  inherits the CLIENT_OFFLINE_GRACE_SECONDS setting. */
  OfflineGraceSeconds?: number | null;
  /** The monitored system checks (CPU, memory, uptime, power, thermal). */
  SystemChecks?: ClientSystemChecks;
  /** System-check conditions currently failing. Empty while healthy or offline. */
  ResourceAlarms?: ClientResourceAlarm[];
  Online?: boolean;
  LastSeen?: number;
  Vitals?: Vitals | null;
  /**
   * When the client's operating system last booted (ms since epoch), derived
   * from its reported uptime. Null until a heartbeat carrying uptime arrives;
   * retained while offline so the last known boot stays visible.
   */
  BootTime?: number | null;
  /** Battery, mains and sleep/resume. Null until the client reports it. */
  PowerStatus?: PowerStatusSnapshot | null;
  /** Temperature sensors. Null until the client reports them. */
  Temperatures?: TemperaturesSnapshot | null;
  USBDeviceList?: USBDeviceView[];
  CriticalUSBDevices?: CriticalUSBDevice[];
  CriticalUSBSerials?: string[];
  MissingCriticalUSBDevices?: MissingCriticalUSBDevice[];
  CriticalUSBNames?: CriticalUSBName[];
  MissingCriticalUSBNames?: MissingCriticalUSBName[];
  /** Null until this connection has reported its USB devices. */
  USBCapabilities?: USBCapabilities | null;
  Degraded?: boolean;
  DegradedWarnings?: string[];
  /** Online, but inside its start-up window with a critical application, USB
   *  device, display or audio endpoint still unaccounted for. The machine is booting, so the
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
  AudioDevices?: AudioDevicesView;
  CriticalAudioDevices?: CriticalAudioDevice[];
  NetworkStatus?: NetworkStatusView;
  CriticalNetworkInterfaces?: CriticalNetworkInterface[];
  StorageStatus?: StorageStatusView;
  CriticalStorageVolumes?: CriticalStorageVolume[];
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
  // Columns spanned when not full width. Renderers clamp it to the configured
  // column count, so it may exceed the columns currently on screen.
  ColumnSpan?: number;
  // Background tint: an index into the shared colour palette (the one scripts
  // and tags use), or null for the plain untinted box.
  Colour?: number | null;
  KeyBind?: string | null;
  // Stable, human-friendly OSC/API identifier; unique among groups.
  Slug?: string | null;
}

/**
 * Tag membership scope (same shape as ScriptWhitelistScope / AlertRuleScope).
 * `Workspace: true` means every client carries the tag; otherwise membership is
 * the union of the listed groups (by GroupID, dynamic: current AND future
 * members), tags (by TagID, dynamic; a tag can therefore be a superset of
 * other tags) and clients (by scoped ID: plain UUID, or `monitor:`/`check:`...).
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
 * scopes) while drawing nothing: the intended shape for tags that exist purely
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
// camelCase, some PascalCase; see per-type notes.
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
 * `Tags` is optional on the wire: rows written before tag support omit it and
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
  confirmation: ScriptConfirmationLevel;
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

/**
 * How hard a script asks before it runs. "Critical" is a full-screen red
 * warning whose default action is Cancel. On disk this is the `Confirmation`
 * boolean plus an optional `ConfirmationStyle: "Critical"`.
 */
export type ScriptConfirmationLevel = 'None' | 'Standard' | 'Critical';

/** `SetScriptList` push catalog entry (PascalCase; serialized Script class). */
export interface ScriptCatalogEntry {
  ID: string;
  Name: string;
  Description: string;
  Colour: number;
  Icon: string;
  Weight: number;
  /** True for both Standard and Critical; kept for consumers that predate levels. */
  Confirmation: boolean;
  /** Absent from servers that predate levels: fall back to `Confirmation`. */
  ConfirmationLevel?: ScriptConfirmationLevel;
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
   * Per-show whitelist scope. `null`/absent means unrestricted (all clients),
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
 * Give either `Equals` (exact match) or `In` (membership); `In` exists so a
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
  /** 'string' (default) | 'number' | 'boolean' | 'select' | 'list' | 'names' | 'channels'. */
  Type: string;
  Default?: unknown;
  Min?: number;
  Max?: number;
  Options?: Array<string | { value: string; label?: string }>;
  /** For Type 'list': how each entry is validated/coerced ('string' | 'number'). */
  ItemType?: 'string' | 'number';
  /**
   * For Type 'names': one name box per channel, Count of them. The value is a
   * string[] of that length; a blank entry means the default, which is
   * ItemDefault with {n} replaced by the channel number (e.g. 'Channel {n}').
   */
  Count?: number;
  ItemDefault?: string;
  /**
   * For Type 'channels': a checkbox per channel, in these groups. The value is a
   * string[] of the ticked channels' IDs, `<Prefix>:<n>` (e.g. 'out:1'). Each
   * box is labelled with the name from the 'names' setting NamesKey, if any.
   */
  Groups?: MonitoringChannelGroup[];
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

/** See MonitoringSettingField.Groups. */
export interface MonitoringChannelGroup {
  Prefix: string;
  Label: string;
  Count: number;
  /** The default name, with {n} for the channel number, e.g. 'Mix {n}'. */
  ItemDefault: string;
  /** The 'names' setting that names these channels, if any. */
  NamesKey?: string;
}

export interface MonitoringMethodInfo {
  Summary: string;
  Setup?: string[];
  /** External references rendered as browser-opening buttons at the panel's foot. */
  Links?: Array<{ Label: string; Url: string }>;
}

/**
 * One controllable action a monitoring method declares: something the operator
 * can DO to the monitored device, as opposed to something the check reads.
 *
 * Actions are addressed as `<Method>/<ActionID>` everywhere (UI, IPC, OSC), so
 * a method owns its own action namespace and a new check type gains a control
 * surface without any transport learning about it.
 */
export interface MonitoringActionDef {
  /** Stable, dot-separated and OSC-safe within its method, e.g. `power.on`. */
  ID: string;
  Label: string;
  /** Bootstrap Icons name without the `bi-` prefix. */
  Icon: string;
  /** Grouping label for the monitor modal's control panel (e.g. "Power"). */
  Group: string;
  /** Parameter schema, rendered by the same field renderer as check settings. */
  Params?: MonitoringSettingField[];
  /** Needs a confirmation dialog before it is sent. */
  Destructive?: boolean;
  /**
   * Stays enabled while the check is offline. Controls are otherwise disabled
   * for an offline check, but a recovery action (rebooting a player whose status
   * endpoint has stopped answering) is needed most at exactly that moment.
   */
  AllowedWhileOffline?: boolean;
  Note?: string;
}

/**
 * Per-check choices for an action parameter, keyed by the parameter's Key and
 * refreshed from each probe. Lets a method offer what THIS device actually
 * supports (the input sources a projector reports) in place of the static
 * schema's free-text field.
 */
export type MonitoringActionOptions = Record<string, Array<{ value: string; label: string }>>;

/** A starred action, offered in the context menu for any selected monitor whose checks declare it. */
export interface MonitoringActionFavouriteView {
  FavouriteID: number;
  Method: string;
  ActionID: string;
  /** Parameters baked into the favourite, so "Set Input - Digital 1" is one entry. */
  Params: Record<string, unknown>;
  /** Resolved display label, including any parameter summary. */
  Label: string;
  /** Bootstrap Icons name without the `bi-` prefix, copied from the action. */
  Icon: string;
  Weight: number;
}

/** One check's outcome from a fanned-out action run. */
export interface MonitoringActionOutcome {
  TargetID: number;
  CheckID: number;
  /** The target's nickname, so a failure can name the projector that refused. */
  Nickname: string;
  Success: boolean;
  Error: string | null;
  Detail: string | null;
}

export interface MonitoringActionSummary {
  Total: number;
  Succeeded: number;
  Failed: number;
  Results: MonitoringActionOutcome[];
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
  // Controllable actions this method offers (empty for read-only check types).
  Actions: MonitoringActionDef[];
  // What a device this method monitors looks like on the network; null when the
  // LAN discovery wizard never suggests it.
  Discovery: MonitoringMethodDiscovery | null;
}

/** A method's LAN discovery signature (see MonitoringMethods/types.ts). */
export interface MonitoringMethodDiscovery {
  Confidence: 'high' | 'medium' | 'low';
  TcpPorts?: number[];
  ServiceTypes?: string[];
  PJLink?: boolean;
  PortSetting?: string;
  NameSetting?: string;
  PortSettings?: Record<string, Record<string, unknown>>;
  ServiceSettings?: Record<string, Record<string, unknown>>;
}

export interface MonitoringCheckView {
  CheckID: number;
  TargetID: number;
  Name: string;
  Address: string;
  Method: string;
  Settings: Record<string, unknown>;
  DegradedThresholdMs: number;
  /**
   * Consecutive failed probes needed before this check reads offline. `null`
   * inherits the target's value (which in turn inherits the server-wide
   * default); `EffectiveFailureThreshold` is the value actually in force.
   */
  FailureThreshold: number | null;
  EffectiveFailureThreshold: number;
  /**
   * Failed probes in a row so far. Below the threshold the check keeps its last
   * verdict, so a non-zero count on an online check means "missed, not yet down".
   */
  ConsecutiveFailures: number;
  Weight: number;
  LastSuccessAt: number | null;
  Online: boolean;
  Degraded: boolean;
  LastChecked: number | null;
  LastLatencyMs: number | null;
  LastError: string | null;
  /**
   * Dynamic choices for this check's action parameters, refreshed on every
   * probe. Absent until the first successful run reports any.
   */
  ActionOptions?: MonitoringActionOptions;
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
  /**
   * Target-wide override for consecutive failures before a check reads offline.
   * `null` inherits the server-wide default; individual checks may override it.
   */
  FailureThreshold: number | null;
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
  /**
   * A custom footer for the dashboard tile, in place of the latency line. Only
   * set when the monitor has exactly one check and that check's method offers a
   * widget (e.g. 'levels': live output meters). Absent from older servers.
   */
  TileWidget?: MonitoringTileWidgetView | null;
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
  /** Failed probes in a row, and how many it takes to read offline. */
  ConsecutiveFailures: number;
  EffectiveFailureThreshold: number;
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
  /** Unit a threshold is typed in when it is not the reading's own (uptime: days). */
  ThresholdUnit?: string;
  /** Reading units per threshold unit (86400 seconds per day). Defaults to 1. */
  ThresholdScale?: number;
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
  /** The API key itself is never broadcast, only whether one is configured. */
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
 * to opening the editor, the one place the key has to be shown, because it is
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
 * `Workspace` is true). `Tags` is optional: rules stored before tag support
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
  /** Completes "When <target> ..." in a rule summary, e.g. "is offline". */
  Summary: string;
  /** Picker group, e.g. "Status" or "Audio". The catalog is ordered by it. */
  Category: string;
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
  /** Every MAC FOG holds for the host, primary first, normalized. Absent from
   *  servers that predate it. */
  MacAddresses?: string[];
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
  /** Shown in Preferences only while every BOOLEAN setting named here is on. */
  ShowWhen?: string[] | null;
}

export interface SettingGroupView {
  Name: string;
  Title: string;
  /** As SettingView.ShowWhen, for the whole group and its tab. */
  ShowWhen?: string[] | null;
  /** Renders inside this group's tab, under its own heading, not as a tab. */
  Parent?: string | null;
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
 * A single-use pairing code, for display as a QR. Short-lived by design: it is
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
  // Probe results: every TCP port found open on the host, across the liveness
  // ports and every port a check type's discovery signature names.
  OpenPorts?: number[];
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

/** One accepted value for a route's placeholder(s), e.g. `pjlink/power.on`. */
export interface OSCRouteValue {
  Value: string;
  Label: string;
  Note?: string;
}

export interface OSCRoute {
  Title: string;
  Path: string;
  /**
   * Every value the route accepts, when they come from a fixed catalogue (check
   * actions, FreeKiosk commands). Absent for routes whose values are the
   * operator's own data, such as slugs and script IDs.
   */
  Values?: {
    /** The placeholder(s) the entries fill, e.g. `Method/ActionID`. */
    Param: string;
    Entries: OSCRouteValue[];
  };
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

/** One server log line, as streamed to an open log console. */
export interface LogConsoleEntry {
  /** Monotonic per server run; a viewer drops live lines it already holds. */
  Seq: number;
  /** Epoch ms. */
  Time: number;
  /** 'error' | 'warn' | 'info' | 'debug' | 'trace'. */
  Level: string;
  /** The logger's label: Info, Warn, Error, Debug, Trace, Success or Database. */
  Type: string;
  /** The module that logged it. */
  Alias: string;
  Message: string;
}

/** What opening (or re-levelling) the log console returns. */
export interface LogConsoleSnapshot {
  /** The level the server settled on (an unknown level falls back to 'info'). */
  Level: string;
  /** The recent lines at that level, oldest first. */
  Entries: LogConsoleEntry[];
}

/** See MonitoringTargetView.TileWidget. */
export interface MonitoringTileWidgetView {
  /** Which drawer the dashboard uses, e.g. 'levels'. */
  Kind: string;
  /** The check the widget belongs to. */
  CheckID: number;
  /** Whatever that drawer needs from the check's last result, if anything. */
  Data?: unknown;
}

// ---- Live levels -------------------------------------------------------------

/** One check's live audio meters, as streamed to an open monitor view. */
export interface MonitorLiveLevelsCheck {
  CheckID: number;
  /** The check's own name; empty when it has none. */
  Name: string;
  /** 'connecting' until the first meters arrive; 'unavailable' carries Message. */
  State: 'connecting' | 'live' | 'unavailable';
  Message: string | null;
  /**
   * dBFS per channel; null = no signal (−∞) or not yet read. Group heads a block
   * of meters ('Inputs', 'Outputs'); Tile marks the ones shown on the dashboard
   * tile.
   */
  Channels: MonitorLiveLevelsChannel[];
}

export interface MonitorLiveLevelsChannel {
  /** What to send back to move it, e.g. 'in:3'. */
  ID: string;
  Group: string;
  Label: string;
  Db: number | null;
  /** Shown in the monitor view (its group is toggled on there). */
  View?: boolean;
  /** Shown on the dashboard tile. */
  Tile?: boolean;
  /** The view may move this channel's fader and mute (live control is on). */
  Control?: boolean;
  /** The channel's fader in dB, null = −∞; absent until read. */
  Fader?: number | null;
  Muted?: boolean;
}

/** A fader level (dB, null = −∞) or a mute, sent from the monitor view. */
export interface MonitorLiveLevelChange {
  Fader?: number | null;
  Muted?: boolean;
}

/** What moving a live fader or mute came to; Error is shown to the operator. */
export interface MonitorLiveLevelResult {
  Success: boolean;
  Error?: string;
  Detail?: string;
}

/** Every streaming check on one monitor. Sent in full on each update. */
export interface MonitorLiveLevelsSnapshot {
  TargetID: number;
  Checks: MonitorLiveLevelsCheck[];
}

/** One monitor tile's live meters (its widget's tile channels only). */
export interface MonitorTileLevels {
  TargetID: number;
  CheckID: number;
  State: 'connecting' | 'live' | 'unavailable';
  Message: string | null;
  Channels: Array<{ Label: string; Db: number | null }>;
}

/** Every dashboard tile with a 'levels' widget. Sent in full on each update. */
export interface MonitorTileLevelsSnapshot {
  Tiles: MonitorTileLevels[];
}

// ---- Audit log ---------------------------------------------------------------

/** What an audit entry is about. `system` covers show files, mode and settings. */
export type AuditEntityType =
  | 'client'
  | 'freekiosk'
  | 'dummy'
  | 'monitor'
  | 'group'
  | 'tag'
  | 'script'
  | 'alert-rule'
  | 'variable'
  | 'system';

/** `status` = something the server observed; `edit` = someone changed the show; `action` = someone did something (WOL, script run, identify). */
export type AuditCategory = 'status' | 'edit' | 'action';

export type AuditSeverity = 'info' | 'success' | 'warning' | 'error';

/**
 * One run of text in an entry's summary. `H` marks text to highlight: the
 * entity itself, a device/interface/application name, or a value (a port, an
 * address, a mode).
 */
export interface AuditSegment {
  T: string;
  H?: 'entity' | 'device' | 'value';
}

/** One field an edit changed, already formatted for reading. */
export interface AuditChange {
  Field: string;
  From: string | null;
  To: string | null;
}

/**
 * One audit log entry. Names are captured when the entry is written, so an
 * entry still reads correctly after its entity is renamed, deleted, or another
 * show file is opened.
 */
export interface AuditLogEntry {
  /** Ascending per database; newer entries have larger IDs. */
  ID: number;
  /** Epoch ms. */
  Timestamp: number;
  EntityType: AuditEntityType;
  /** UUID, TargetID, GroupID, etc. as a string; null for system-wide entries. */
  EntityID: string | null;
  EntityName: string | null;
  Category: AuditCategory;
  Severity: AuditSeverity;
  Summary: AuditSegment[];
  /** Field-by-field detail for an edit; empty otherwise. */
  Changes: AuditChange[];
  /** Further detail lines (the warnings behind a degraded state, a check's error). */
  Details: string[];
  /** Which surface made an edit or action: Desktop, Web UI, OSC, HTTP API, SDK, etc. Null for observed status. */
  Source: string | null;
}

/** A read of the audit log, newest first. Every field is optional. */
export interface AuditLogQuery {
  EntityType?: AuditEntityType | null;
  EntityID?: string | null;
  Category?: AuditCategory | null;
  /** Case-insensitive match against the summary, entity name and details. */
  Search?: string | null;
  /** Only entries older than this ID (paging back through the log). */
  BeforeID?: number | null;
  /** Page size; clamped to 1–500, default 200. */
  Limit?: number | null;
}

export interface AuditLogPage {
  Entries: AuditLogEntry[];
  /** True when older entries match the query beyond this page. */
  HasMore: boolean;
}

// ---- Client history -------------------------------------------------------

/**
 * The recent overall-status history of everything on the page, in one read
 * (GetStatusHistoryOverview). Each map is keyed by the entity's id as a string:
 * a client or dummy UUID, a monitoring CheckID, a FreeKiosk terminal UUID.
 *
 * Checks rather than targets, because a target's overall timeline is combined
 * from its checks by the renderer. Kiosks carry their poll-latency series (the
 * reachability series their status timeline is drawn from), including the one
 * sample just before the window that a flat run is carried forward from.
 */
export interface StatusHistoryOverview {
  Clients: Record<string, HistorySample[]>;
  Dummies: Record<string, HistorySample[]>;
  Checks: Record<string, HistorySample[]>;
  Kiosks: Record<string, FreeKioskMetricSample[]>;
}

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

export interface ClientAudioHistorySeries {
  EndpointID: string;
  Name: string;
  samples: HistorySample[];
}

/** One critical network interface's timeline; keyed by interface name. */
export interface ClientNetworkHistorySeries {
  InterfaceName: string;
  Name: string;
  samples: HistorySample[];
}

/** One monitored storage volume's timeline; keyed by mount point. */
export interface ClientStorageHistorySeries {
  MountPoint: string;
  Name: string;
  samples: HistorySample[];
}

/** One monitored system check's healthy/failing timeline; keyed by check. */
export interface ClientSystemCheckHistorySeries {
  CheckKey: ClientSystemCheckKey;
  Name: string;
  samples: HistorySample[];
}
