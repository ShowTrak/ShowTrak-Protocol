// The `/sdk` Socket.IO namespace: ShowTrak Server's external control API, used
// by integrations holding an API key (the TypeScript SDK, the Companion module)
// and by paired devices (ShowTrak Remote).
//
// Derived from the Server (src/Modules/Server/sdk-namespace.ts, ControlService
// and RemoteAccess), which is the source of truth. ShowTrakServer-SDK-TS keeps
// a deliberately reduced, standalone mirror for its npm consumers; the command
// and channel names here match it.
//
// Compatibility runs both ways and is additive only: an SDK never sends a
// command it does not know, an older server answers a newer command with
// { ok: false, detail: 'Unknown command "..."' }, and a push an SDK does not
// listen for is simply ignored. Names and argument shapes never change.

import type { AppMode } from './app';
import type { ScriptCatalogEntry } from './scripts';
import type { USBDevice } from './telemetry';
import type {
  AlertRuleView,
  AudioAssetData,
  AuditLogEntry,
  ClientView,
  GroupView,
  MonitorLiveLevelsSnapshot,
  MonitoringActionFavouriteView,
  OSCRoute,
  ScriptExecutionView,
  SettingGroupView,
  SettingView,
  ShowTrakAlert,
  TagView,
} from './views';

// ---- Handshake --------------------------------------------------------------

/**
 * The Socket.IO handshake `auth` payload. The server tries, in order: a device
 * token, a pairing request, then an API key. A refused handshake fails the
 * connection with a message ('Unauthorized', 'Device revoked', 'Remote pairing
 * is disabled', 'Too many failed attempts. Try again in <n>s', ...).
 */
export interface SdkHandshakeAuth {
  /** A paired device's token, as the 'paired' event returned it. Wins over everything else. */
  deviceToken?: string;
  /**
   * Ask to pair a new device. Explicit, because pairing with workspace
   * protection off carries no credential at all.
   */
  pair?: boolean;
  /** Pairing: the single-use code from the pairing QR, shown at the desk. */
  pairingCode?: string;
  /** Pairing without a code: the workspace PIN, when protection is on. */
  pin?: string;
  /** Pairing: how the device names itself in the paired-device list and the audit log. */
  deviceName?: string;
  /** Pairing: 'ios' or 'android'; anything else is stored as null (unknown). */
  platform?: string;
  /** An integration's API key (Settings > SDK). */
  apiKey?: string;
}

/**
 * How a session authenticated. Paired devices ('device') also get the `rpc`
 * bridge, live levels and the device-only pushes; an API key ('apikey') gets
 * the command surface only.
 */
export type SdkAuthMode = 'apikey' | 'device';

/**
 * Sent once, first thing after a successful pairing: the only time the
 * device token exists outside the device (the server keeps only its hash).
 */
export interface SdkPairedPayload {
  deviceId: string;
  deviceToken: string;
}

// ---- Commands ---------------------------------------------------------------

/** A client-list layout. */
export type SdkViewMode = 'grid' | 'compact' | 'list';

/**
 * Every command the control API accepts, and its arguments (an object; `{}` for
 * none). Targets are slugs: a client's, group's, tag's, terminal's or dummy's.
 */
export interface SdkCommandArgs {
  'wol.all': Record<string, never>;
  'wol.client': { slug: string };
  'wol.group': { slug: string };
  'wol.tag': { slug: string };
  'script.all': { scriptSlug: string };
  'script.client': { slug: string; scriptSlug: string };
  'script.group': { slug: string; scriptSlug: string };
  'script.tag': { slug: string; scriptSlug: string };
  /** Integrated events: integrated clients only. */
  'event.all': { eventSlug: string };
  'event.client': { slug: string; eventSlug: string };
  'event.group': { slug: string; eventSlug: string };
  'event.tag': { slug: string; eventSlug: string };
  'alerts.set': { enabled: boolean };
  'alerts.toggle': Record<string, never>;
  /** Anything but 'EDIT' (any case) sets Show Mode. */
  'mode.set': { mode: AppMode };
  'mode.toggle': Record<string, never>;
  /**
   * Server 3.34+. `mode` names the layout; earlier SDKs sent `{ compact }`,
   * which servers still read as compact vs grid when `mode` is absent.
   */
  'view.set': { mode: SdkViewMode } | { compact: boolean };
  /** Compact on or off. Server 3.34+. */
  'view.toggle': Record<string, never>;
  /**
   * A monitoring check action (a projector's power, a console's scene), as the
   * OSC /API/Monitor routes offer. `value` fills the action's first declared
   * parameter; `params` names any of them and wins. Server 3.34+.
   */
  'monitor.action': {
    slug: string;
    method: string;
    actionId: string;
    value?: string | number;
    params?: Record<string, unknown>;
  };
  /** A FreeKiosk command; `value` fills its one parameter (brightness, volume: 0-100). Server 3.34+. */
  'freekiosk.terminal': { slug: string; commandId: string; value?: string | number };
  'freekiosk.group': { slug: string; commandId: string; value?: string | number };
  'freekiosk.tag': { slug: string; commandId: string; value?: string | number };
  'freekiosk.all': { commandId: string; value?: string | number };
  /** Deliver a heartbeat to a dummy client on behalf of what it stands for. Server 3.34+. */
  'dummy.heartbeat': { slug: string };
  /** Server 3.34+. */
  'executions.retryFailed': Record<string, never>;
  /** Server 3.34+. */
  'executions.clearSettled': Record<string, never>;
  /** Flashes an overlay on the client's screen. Allowed in Show Mode: it changes nothing. */
  'identify.client': { slug: string };
  'identify.stop': { slug: string };
  /** Desktop app only; the Web UI ignores these. */
  'modal.openClient': { slug: string };
  'modal.closeAll': Record<string, never>;
  'show.save': Record<string, never>;
  /** Graceful: honours the save and Show Mode prompts. */
  'system.shutdown': Record<string, never>;
  /** Skips the prompts. */
  'system.shutdownForce': Record<string, never>;
}

export type SdkCommandName = keyof SdkCommandArgs;

/** Every command's acknowledgement, including an unknown command's. */
export interface SdkCommandResult {
  ok: boolean;
  /** What happened, for a person to read. */
  detail: string;
}

/** The arguments of a `command` emit, the name correlated with its arguments. */
export type SdkCommandEmitArgs = {
  [C in SdkCommandName]: [
    name: C,
    args: SdkCommandArgs[C],
    ack: (result: SdkCommandResult) => void,
  ];
}[SdkCommandName];

// ---- Management bridge (paired devices only) --------------------------------

/**
 * Why an `rpc` call was refused. 'forbidden' covers an API-key session (rpc is
 * device-only) and a surface permission that is off; 'edit_mode_required' an
 * edit attempted in Show Mode.
 */
export type SdkRpcError =
  'forbidden' | 'edit_mode_required' | 'invalid_channel' | 'unknown_channel' | 'failed';

/**
 * The answer to an `rpc` call: what the Server's shared IPC handler for that
 * channel returned (the same handlers the desktop and Web UI call, with
 * secrets removed), or why it was refused.
 */
export type SdkRpcResponse = { result: unknown } | { error: SdkRpcError };

/** The answer to `monitorlive:open`: the monitor's meters now, or why not. */
export type SdkLiveLevelsResponse =
  { result: MonitorLiveLevelsSnapshot } | { error: 'forbidden' | 'failed' };

/** Events an SDK session sends to the server. */
export interface SdkClientToServerEvents {
  /** Run a command (see SdkCommandArgs). */
  command: (...args: SdkCommandEmitArgs) => void;
  /**
   * Call one of the Server's IPC channels (`channel`, with `args` spread into
   * it), behind the same capability model as the Web UI. Device sessions only.
   */
  rpc: (channel: string, args: unknown[], ack: (response: SdkRpcResponse) => void) => void;
  /** Stream one monitor's live audio meters to this session. Device sessions only. */
  'monitorlive:open': (targetId: number, ack: (response: SdkLiveLevelsResponse) => void) => void;
  'monitorlive:close': () => void;
}

// ---- Pushes -----------------------------------------------------------------

/** A device waiting to be adopted (`SetDevicesPendingAdoption`). */
export interface PendingAdoptionView {
  State: 'Pending';
  UUID: string;
  /** 'No Hostname Found' when the client sent none. */
  Hostname: string;
  /** 'No Version Found' when the client sent none. */
  Version: string;
  /** 'No IP Found' when unknown. */
  IP: string;
  /** Identify is active on it (the pending tile pulses). */
  Identifying: boolean;
}

/**
 * Events the server sends to SDK sessions. Monitors, dummies and FreeKiosk
 * terminals are projected into the client shape (`Type` 'monitor', 'dummy',
 * 'freekiosk') so an integration treats every tile alike. On connect the server
 * sends the current state on these same channels.
 */
export interface SdkServerToClientEvents {
  /** First thing after a successful pairing; see SdkPairedPayload. */
  paired: (payload: SdkPairedPayload) => void;
  SetFullClientList: (clients: ClientView[], groups: GroupView[]) => void;
  ClientUpdated: (client: ClientView) => void;
  SetFullMonitoringTargetList: (monitors: ClientView[]) => void;
  MonitoringTargetUpdated: (monitor: ClientView) => void;
  SetFullDummyClientList: (dummies: ClientView[]) => void;
  DummyClientUpdated: (dummy: ClientView) => void;
  SetFullFreeKioskTerminalList: (terminals: ClientView[]) => void;
  FreeKioskTerminalUpdated: (terminal: ClientView) => void;
  /** The current catalog, each entry decorated with its Whitelist. */
  SetScriptList: (scripts: ScriptCatalogEntry[]) => void;
  SetTagList: (tags: TagView[]) => void;
  ModeUpdated: (mode: AppMode) => void;
  AlertActionsUpdated: (enabled: boolean) => void;
  /** The whole list on every change; also sent on connect from Server 3.34. */
  UpdateScriptExecutions: (executions: ScriptExecutionView[]) => void;
  /** `type` is 'info' and `duration` 5000 ms unless the notification says otherwise. */
  Notify: (message: string, type: string, duration: number) => void;
  /** Also sent on connect, to every session from Server 3.34 (devices only before). */
  SetDevicesPendingAdoption: (devices: PendingAdoptionView[]) => void;
  CreateShowTrakAlert: (alert: ShowTrakAlert) => void;
  // Device sessions only (see SdkDeviceOnlyPushChannel). SDK releases before
  // 1.7 do not listen for any of these.
  SetFullAlertRuleList: (rules: AlertRuleView[]) => void;
  USBDeviceAdded: (client: ClientView, device: USBDevice) => void;
  USBDeviceRemoved: (client: ClientView, device: USBDevice) => void;
  SetOSCList: (routes: OSCRoute[]) => void;
  PlaySound: (soundName: string) => void;
  /** Carries a whole audio file. */
  PlayCustomAudio: (asset: AudioAssetData) => void;
  AudioAssetsUpdated: (assets?: unknown) => void;
  SetFullMonitoringActionFavouriteList: (favourites: MonitoringActionFavouriteView[]) => void;
  AuditLogAppended: (entries: AuditLogEntry[]) => void;
  /**
   * Only the public display settings; never the list as it is broadcast, which
   * holds the API key and the workspace PIN. `groups` is always empty.
   */
  UpdateSettings: (settings: SettingView[], groups: SettingGroupView[]) => void;
  /** A monitor's meters, while this session holds it open (`monitorlive:open`). */
  'MonitorLiveLevels:Frames': (snapshot: MonitorLiveLevelsSnapshot) => void;
}

/** The pushes only a paired device is sent: management screens and the alert tray's sounds. */
export type SdkDeviceOnlyPushChannel =
  | 'SetFullAlertRuleList'
  | 'USBDeviceAdded'
  | 'USBDeviceRemoved'
  | 'SetOSCList'
  | 'PlaySound'
  | 'PlayCustomAudio'
  | 'AudioAssetsUpdated'
  | 'SetFullMonitoringActionFavouriteList'
  | 'AuditLogAppended'
  | 'UpdateSettings';

/**
 * The renderer channels forwarded to SDK sessions (the Server's
 * SDK_PUSH_ALLOWLIST): every push above except the per-session 'paired' and
 * 'MonitorLiveLevels:Frames'.
 */
export type SdkPushChannel = Exclude<
  keyof SdkServerToClientEvents,
  'paired' | 'MonitorLiveLevels:Frames'
>;
