// Shared primitive types used across ShowTrak wire payloads.

/**
 * One interface's entry in a `MacAddressMap`. Each key is the LAST address of
 * that family the OS listed for the interface; `mac` is omitted for adapters
 * with no hardware address (an all-zero MAC: VPN and tunnel interfaces).
 */
export interface MacAddressEntry {
  ipv4?: string;
  ipv6?: string;
  mac?: string;
}

/**
 * Map of network-interface name to its addresses, as reported by the client's
 * OS module (`OS.GetMacAddresses`). Only interfaces with at least one
 * non-internal address appear, so loopback never does.
 *
 * NOTE: this was previously declared `Record<string, string>`. Nothing ever
 * sent a bare string: the value has always been the object above, and the
 * server derives the Wake-on-LAN set from `.mac` and matches `.ipv4` against
 * the socket's address.
 */
export type MacAddressMap = Record<string, MacAddressEntry>;

/**
 * Deployment fingerprint for the script catalog currently applied on a client,
 * or `null` when the client has not yet applied any deployment.
 */
export type ScriptsFingerprint = string | null;

/** A unique client/device identifier (UUID string). */
export type ClientUUID = string;
