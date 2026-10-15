// Client -> Server telemetry payloads.

import type { MacAddressMap, ScriptsFingerprint } from './common';
import type { Vitals } from './vitals';

/** Payload of the 1s `Heartbeat` event. */
export interface HeartbeatPayload {
  Version: string;
  Vitals: Vitals;
  ScriptsFingerprint: ScriptsFingerprint;
}

/** Payload of the 20s `SystemInfo` event. */
export interface SystemInfoPayload {
  Hostname: string;
  OperatingSystem: string;
  MacAddresses: MacAddressMap;
}

/**
 * A USB device's Windows Plug and Play state (Device Manager's yellow bang).
 * `ErrorCode` is the Configuration Manager problem code: 0 when the device is
 * working, e.g. 10 "cannot start", 28 "drivers not installed", 43 "stopped".
 */
export interface USBDeviceState {
  ErrorCode: number;
  /** Operator-facing description of a non-zero code; null when working. */
  Message: string | null;
}

/**
 * A USB device as formatted by the client's USB monitor.
 * Fields may be `undefined` when WebUSB cannot read a descriptor.
 *
 * `Location`, `FirmwareVersion` and `DeviceState` arrived with ShowTrak Client
 * 3.21.0. A key that is ABSENT means the client cannot report it at all (an
 * older client, or `DeviceState` off Windows); null means it can, but could not
 * for this device this time. Neither is ever a fault.
 */
export interface USBDevice {
  VendorID?: number;
  ProductID?: number;
  ManufacturerName?: string | null;
  ProductName?: string | null;
  SerialNumber?: string | null;
  /** Where it is plugged in: "BUS-PORT[.PORT…]", the path through any hubs, e.g. "1-2.4". */
  Location?: string | null;
  /** The device's release number (bcdDevice), e.g. "1.23". */
  FirmwareVersion?: string | null;
  /** Windows only. */
  DeviceState?: USBDeviceState | null;
}

/** Source tier used to derive a reboot-stable display identity. */
export type DisplayIdentitySource = 'edid' | 'port' | 'attributes' | 'session';

export interface DisplayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A display as reported by the client's `DisplayList` event. */
export interface ClientDisplay {
  /** Electron runtime handle (NOT reboot-stable). */
  SessionID: string;
  /** 1-based position in Electron's enumeration (matches Identify overlay). */
  ScreenNumber: number;
  /** Reboot-stable identity where possible; falls back to `session:<id>`. */
  DisplayID: string;
  HardwareID: string | null;
  IsStableIdentity: boolean;
  IdentitySource: DisplayIdentitySource;
  Label: string | null;
  Width: number;
  Height: number;
  ScaleFactor: number;
  RefreshRate: number | null;
  Rotation: number;
  Internal: boolean;
  Primary: boolean;
  Bounds: DisplayBounds;
}

/**
 * A single address bound to a network interface. Field names are lower-case
 * because the client passes Node's `os.networkInterfaces()` entries through
 * almost verbatim.
 */
export interface NetworkInterfaceAddress {
  /** `'IPv4'`/`'IPv6'` on Node < 18; may be the number 4/6 on Node >= 18. */
  family: string | number;
  address: string;
  /** Null when the OS did not report one (NetworkMonitor normalizes it away). */
  netmask: string | null;
  cidr: string | null;
  /** Upper-cased by the client; null when the OS did not report one. */
  mac: string | null;
  internal: boolean;
  scopeid: number | null;
  /**
   * Server-side annotation, not sent by the client: whether the address is
   * currently live. Consumers fall back to inspecting `address` when absent.
   */
  active?: boolean;
}

/**
 * A network interface reported by the client's `NetworkInterfaces` event.
 *
 * NOTE: this previously declared PascalCase `Name`/`Address`/`MAC`/`Family`
 * fields plus an index signature. Nothing ever emitted or read those — the
 * client sends `{ name, addresses[] }` and the server's client-info modal reads
 * `iface.name` / `iface.addresses[].address`. The index signature hid the
 * mismatch; the shape below is what actually goes over the wire.
 */
export interface NetworkInterface {
  name: string;
  addresses: NetworkInterfaceAddress[];
  /**
   * The IPv4 default gateway (router) reached through this interface, or null
   * when it has none. ABSENT when the client cannot tell — an older client, or
   * one whose routing table has never been readable — which the server reads
   * as "unknown", never as "no router".
   */
  gateway?: string | null;
}

export interface RunningApplicationItem {
  Name: string;
  Count: number;
  /**
   * Whether the application's windows are answering the operating system.
   * false means hung ("Not Responding"): the process is alive but frozen.
   *
   * ABSENT when the client cannot tell on this platform at all (see
   * `RunningApplicationsCapabilities.Responding`); null when it can, but could
   * not read this application this time. Neither is ever a fault. With several
   * instances, false means at least one of them is hung.
   */
  Responding?: boolean | null;
}

/**
 * What the client's application collector can report on this machine. Sent
 * with every snapshot and delta so the server can say "not available on this
 * operating system" from the client's own word.
 *
 * Absent on clients before 3.27.0, which report neither.
 */
export interface RunningApplicationsCapabilities {
  /** Hung-application detection (Windows: the window manager's verdict). */
  Responding: boolean;
  /** Which application owns the focused window. */
  Foreground: boolean;
}

/**
 * Health of the client's running-applications collector.
 *
 * NOTE: previously declared `'unsupported' | 'permission'`, neither of which the
 * client ever emits — the real states are the four below, set by
 * ProcessMonitor's `setStatus`/`classifyCollectionError`. The union was widened
 * with `| string`, which stopped the mismatch from being visible.
 */
export type RunningApplicationsState = 'unknown' | 'ok' | 'error' | 'permission_denied';

export interface RunningApplicationsStatus {
  State: RunningApplicationsState;
  Message: string | null;
  Platform?: string;
}

/** Payload of the 20s `RunningApplications` event. */
export interface RunningApplicationsSnapshot {
  SampledAt: number;
  TotalCount: number;
  Truncated: boolean;
  Items: RunningApplicationItem[];
  Status: RunningApplicationsStatus;
  /** Present and `true` when the app set is unchanged (Items omitted). */
  NoChanges?: boolean;
  /**
   * Name of the application that owns the focused window, matching an `Items`
   * entry's `Name` where it is listed. ABSENT when the client cannot report it
   * (see `Capabilities.Foreground`); null when nothing is focused or the owner
   * could not be read.
   */
  Foreground?: string | null;
  Capabilities?: RunningApplicationsCapabilities;
}

// --- Audio devices -----------------------------------------------------------
//
// Reported as a full snapshot on every change and on a short keepalive. An audio
// rig has a handful of endpoints, so a whole snapshot is a few hundred bytes and
// a delta protocol would buy nothing but a second code path.

/** Which way audio flows through an endpoint. */
export type AudioDirection = 'input' | 'output';

/** How a device is attached, as far as the operating system will say. */
export type AudioTransport =
  | 'builtin'
  | 'usb'
  | 'bluetooth'
  | 'hdmi'
  | 'displayport'
  | 'thunderbolt'
  | 'firewire'
  | 'pci'
  | 'network'
  | 'virtual'
  | 'aggregate'
  | 'airplay'
  | 'unknown';

/** The OS facility the client read audio devices through. */
export type AudioBackend = 'coreaudio' | 'wasapi' | 'pulseaudio' | 'alsa';

/**
 * One audio endpoint: a single direction of a single device.
 *
 * A duplex interface (one with both inputs and outputs) is reported as TWO
 * endpoints. That is how Windows and PulseAudio model audio natively, and it
 * keeps "the default input" and "the default output" independent — on macOS the
 * client splits each device itself to match.
 */
export interface AudioEndpoint {
  /**
   * Stable across reboots where the platform allows: the MMDevice id on
   * Windows, the sink/source name on PulseAudio. macOS exposes no device UID to
   * the client, so there it is derived from the direction, manufacturer and name
   * (plus an ordinal when two devices share all three).
   */
  EndpointID: string;
  Direction: AudioDirection;
  Name: string;
  Manufacturer: string | null;
  /** Null when the platform does not report it (see AudioCapabilities). */
  Transport: AudioTransport | null;
  /** Channel count in this endpoint's direction. */
  Channels: number | null;
  /** Nominal sample rate in Hz. */
  SampleRate: number | null;
  /** Whether this is the operating system's default for its direction. */
  IsDefault: boolean;
  /** Level, 0-100 (PulseAudio can report boost above 100). Null when unreadable. */
  Volume: number | null;
  Muted: boolean | null;
}

/**
 * How far a level or mute reading reaches on a platform: every endpoint, only
 * the current default endpoint for that direction, or nothing at all.
 *
 * A level that can be read can also be set remotely; the scope is the same.
 */
export type AudioControlScope = 'device' | 'default' | 'none';

/**
 * What the client's platform can actually report. Sent with every snapshot so
 * the server can say "not available on this operating system" from the
 * client's own word, rather than from a table that drifts from the client.
 */
export interface AudioCapabilities {
  DefaultDevice: boolean;
  Channels: boolean;
  SampleRate: boolean;
  Transport: boolean;
  InputVolume: AudioControlScope;
  OutputVolume: AudioControlScope;
  InputMute: AudioControlScope;
  OutputMute: AudioControlScope;
}

/**
 * Health of the client's audio collector. `unsupported` means no backend works
 * on this machine at all (no audio stack the client knows how to read).
 */
export type AudioMonitorState = 'unknown' | 'ok' | 'error' | 'unsupported';

export interface AudioMonitorStatus {
  State: AudioMonitorState;
  Message: string | null;
  /** Node's `process.platform` on the client. */
  Platform: string;
  /** Null until a backend has answered (and while none can). */
  Backend: AudioBackend | null;
}

/** Payload of the `AudioDevices` event. */
export interface AudioDevicesSnapshot {
  SampledAt: number;
  Endpoints: AudioEndpoint[];
  Status: AudioMonitorStatus;
  Capabilities: AudioCapabilities;
}

/** Server -> client request to change one endpoint's level and/or mute. */
export interface AudioLevelRequest {
  EndpointID: string;
  /** 0-100. Omitted to leave the level alone. */
  Volume?: number;
  /** Omitted to leave the mute state alone. */
  Muted?: boolean;
}

export interface AudioLevelResult {
  Success: boolean;
  Error: string | null;
}

// --- Incremental telemetry (deltas) ----------------------------------------
//
// The full-list events above remain the authority: they are sent on connect and
// on a slow resync, and a server applies one by REPLACING its stored state. The
// delta events below carry only what changed between two samples, so a change
// can be reported the moment it is observed without resending an entire list.
//
// A delta is only ever emitted to a server that advertised `Deltas` in its
// ServerCapabilities. Against an older server the client keeps sending a full
// list on every change instead, so the feature degrades to the previous
// behaviour rather than going silent.
//
// Deltas are never sent with `volatile`: a dropped delta would leave the server
// silently wrong until the next resync, which is exactly what the full-list
// authority is there to bound.

/** Delta for the `NetworkInterfaceDelta` event. Interfaces are keyed by `name`. */
export interface NetworkInterfaceDelta {
  Added: NetworkInterface[];
  /** Names of interfaces that disappeared. */
  Removed: string[];
  /** Interfaces still present whose address set changed. */
  Changed: NetworkInterface[];
}

/** Delta for the `DisplayDelta` event. Displays are keyed by `DisplayID`. */
export interface DisplayDelta {
  Added: ClientDisplay[];
  /** DisplayIDs of displays that disappeared. */
  Removed: string[];
  /** Displays still present whose reported configuration changed. */
  Changed: ClientDisplay[];
}

/**
 * Delta for the `ApplicationDelta` event. Applications are keyed by their
 * case-insensitive name.
 *
 * The counters travel with the delta because the server's view reports them
 * directly, and recomputing them from a partial list would be wrong.
 */
export interface ApplicationDelta {
  Started: RunningApplicationItem[];
  /** Names of applications that are no longer running. */
  Stopped: string[];
  /** Applications still running whose process count changed. */
  Changed: RunningApplicationItem[];
  SampledAt: number;
  TotalCount: number;
  Truncated: boolean;
  Status: RunningApplicationsStatus;
  /**
   * The focused application, carried on every delta (it changes far more often
   * than the application set). Same meaning as the snapshot's field; absent
   * when the client cannot report it.
   */
  Foreground?: string | null;
  Capabilities?: RunningApplicationsCapabilities;
}

// --- Power and temperatures --------------------------------------------------
//
// Both are small full snapshots, sent on connect, on every change and on a slow
// keepalive. Absent on clients before 3.27.0: the server reads "no report" as
// "cannot tell", never as a fault.

/**
 * Health of one of the client's optional collectors. `unsupported` means this
 * machine cannot report the domain at all (no battery API, no readable sensor),
 * which the UI shows as "not available" rather than as a fault.
 */
export type CollectorState = 'unknown' | 'ok' | 'error' | 'unsupported';

export interface CollectorStatus {
  State: CollectorState;
  Message: string | null;
  /** Node's `process.platform` on the client. */
  Platform: string;
  /** The facility that answered, e.g. "wmi", "pmset", "sysfs". Null until one has. */
  Backend: string | null;
}

/** The machine's internal battery. */
export interface BatteryStatus {
  /** Charge, 0-100. Null when unreadable. */
  Percent: number | null;
  /** Charging from mains. Null when the platform does not say. */
  Charging: boolean | null;
  /** Estimated minutes of runtime left while discharging; null otherwise. */
  TimeRemainingMinutes: number | null;
}

/** Payload of the `PowerStatus` event. */
export interface PowerStatusSnapshot {
  SampledAt: number;
  Status: CollectorStatus;
  /** Null when the machine has no battery (a desktop) or it cannot be read. */
  Battery: BatteryStatus | null;
  /** Running from battery rather than mains. Null when unknown. */
  OnBattery: boolean | null;
  /**
   * When the operating system last went to sleep and last woke, as observed by
   * the client process (ms since epoch). Null until it has happened once while
   * the client was running. A suspend is reported best-effort before the
   * machine sleeps; the resume is always reported once the client reconnects.
   */
  LastSuspendAt: number | null;
  LastResumeAt: number | null;
}

/** What a temperature sensor measures. */
export type TemperatureSensorKind = 'cpu' | 'gpu' | 'system' | 'storage' | 'battery' | 'other';

export interface TemperatureSensor {
  /** Stable within a machine, e.g. "CPU Package", "GPU 0", "acpitz". */
  Name: string;
  Kind: TemperatureSensorKind;
  Celsius: number;
}

/**
 * The operating system's own verdict on thermal pressure. macOS reports this
 * (and no temperatures without administrator tools); elsewhere it is null.
 * `serious` and `critical` mean the machine is throttling to cool down.
 */
export type ThermalState = 'nominal' | 'fair' | 'serious' | 'critical';

/** Payload of the `Temperatures` event. */
export interface TemperaturesSnapshot {
  SampledAt: number;
  Status: CollectorStatus;
  /** Empty when no sensor is readable; `Status` then says why. */
  Sensors: TemperatureSensor[];
  ThermalState: ThermalState | null;
}

/**
 * What a server tells a client it understands, in reply to
 * `GetServerCapabilities`.
 *
 * A server that predates this event never invokes the acknowledgement at all,
 * which is the signal the client uses to stay on full lists — so the absence of
 * a reply is meaningful and must not be given a default.
 */
export interface ServerCapabilities {
  /** Whether the server accepts the `*Delta` events. */
  Deltas: boolean;
}
