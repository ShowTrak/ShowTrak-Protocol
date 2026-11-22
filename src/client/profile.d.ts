// ShowTrak Client's persisted profile: Profile.json and ManualServer.json in
// its profile directory. Read by every later release of the Client after an
// upgrade, written by the e2e harness to seed an adopted client, and handed to
// the config window (`Loaded`, `SetProfile`), so its shape is a contract
// across versions and across processes, not just inside one module.
//
// The small state files kept beside them (ScriptDeploymentState.json,
// Variables.json, UpdateChannel.json) are read back by later releases too, so
// they are declared here as well.

import type { UpdateChannel } from '../app';
import type { VariablePayload } from '../variables';

/** Where a client's hardware identity was derived from, best first. */
export type IdentitySource = 'firmware' | 'mac' | 'random';

/**
 * The identity block inside Profile.json. `Witness` is the evidence the UUID
 * was derived from (a lower-cased firmware id, or physical MACs joined by
 * `|`), re-checked against live hardware on every boot to detect a cloned disk
 * image; null only for a random identity.
 */
export interface ProfileIdentity {
  Version: number;
  Source: IdentitySource;
  Witness: string | null;
  ResolvedAt: number;
}

/** The server the client is adopted to. */
export interface ProfileServer {
  IP?: string | null;
  Port?: number | null;
  ServerIdentity?: string | null;
  AdoptionTime?: number;
  /** Set when recovery re-pointed the client at a rediscovered server. */
  LastRecoveredAt?: number;
}

/**
 * An operator-entered server endpoint, kept in ManualServer.json rather than
 * Profile.json so a factory reset of the profile does not lose it. `Host` is an
 * IPv4/IPv6 literal or a DNS name.
 */
export interface ManualServer {
  Host: string;
  Port: number;
}

/**
 * Profile.json, plus the manual endpoint attached when it is read. Every field
 * is optional because a profile on disk may be missing or truncated (the
 * Client self-heals it, so the profile it hands out always has a UUID).
 */
export interface ClientProfile {
  UUID?: string;
  Adopted?: boolean;
  Server?: ProfileServer | null;
  /** Absent from profiles written before hardware identities (they migrate on boot). */
  Identity?: ProfileIdentity;
  ManualServer?: ManualServer;
  /**
   * Survives an unadopt, so the client only re-adopts to the server it was
   * previously locked to.
   */
  ServerIdentityLock?: string;
  /** Keys older or newer releases wrote are kept as they are. */
  [key: string]: unknown;
}

// ---- State files beside the profile -----------------------------------------
//
// Later releases read each one back after an upgrade. A missing, unreadable or
// unrecognised file reads as the default noted, never as an error.

/**
 * ScriptDeploymentState.json: the script deployment last applied in full. Its
 * fingerprint is reported in every `Heartbeat` (`ScriptsFingerprint`), and the
 * Server redeploys when it differs from its own catalog's. Anything but a
 * string reads as null: nothing applied yet.
 */
export interface ScriptDeploymentState {
  LastAppliedDeploymentFingerprint: string | null;
  /** When it was written, ms since epoch. Never read back. */
  UpdatedAt: number;
}

/**
 * Variables.json: the show variables the Server last pushed, kept so the tray
 * menu and run-on-launch can run scripts before (or without) a connection.
 * Read back through the same sanitising as a push: names must match
 * `SHOWTRAK_VAR_[A-Z0-9_]+`, values are coerced to strings, and an `Exported`
 * name missing from `Environment` is dropped.
 */
export interface VariablesState extends VariablePayload {
  /** When it was written, ms since epoch. Never read back. */
  UpdatedAt: number;
}

/**
 * UpdateChannel.json: the update channel chosen in the config window. Anything
 * but a known channel reads as 'stable'; a factory reset deletes the file.
 */
export interface UpdateChannelState {
  Channel: UpdateChannel;
}
