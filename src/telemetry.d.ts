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

export interface RunningApplicationsStatus {
  /** `'ok'` on success; otherwise a classified collection-error state. */
  State: 'ok' | 'error' | 'unsupported' | 'permission' | string;
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
