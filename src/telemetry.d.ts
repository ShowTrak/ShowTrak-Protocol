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
 * A USB device as formatted by the client's USB monitor.
 * Fields may be `undefined` when WebUSB cannot read a descriptor.
 */
export interface USBDevice {
  VendorID?: number;
  ProductID?: number;
  ManufacturerName?: string | null;
  ProductName?: string | null;
  SerialNumber?: string | null;
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
}

export interface RunningApplicationItem {
  Name: string;
  Count: number;
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
