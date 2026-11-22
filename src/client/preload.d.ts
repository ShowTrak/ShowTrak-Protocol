// ShowTrak Client's Electron preload contracts: everything its renderer
// windows can reach in the main process, and everything the main process
// hands them.
//
//   - The config window: `window.API` (ClientPreloadAPI), exposed by
//     src/preload.ts, whose INVOKE_CHANNELS and SUBSCRIBE_CHANNELS allowlists
//     name exactly InvokeChannel and PushChannel below.
//   - The identify overlay windows: `window.IdentifyAPI`, plus the machine
//     details in each window's query string.
//   - The launch countdown window: `window.LaunchCountdownAPI`, plus the
//     script name and countdown in its query string.

import type { AppUpdateStatus, Result, Unsubscribe, UpdateChannel } from '../app';
import type { RunningApplicationsState, RunningApplicationsStatus } from '../telemetry';
import type { ClientProfile } from './profile';

/**
 * How every Client IPC handler answers: `[null, value]`, or `[message, null]`
 * when it threw (a rejected request never throws across the bridge). The one
 * exception is `GetVersion`, which answers with a bare string.
 */
export type IpcResult<T> = Result<T>;

// ---- Pushed status ----------------------------------------------------------

/** Health of the running-applications monitor: the wire's RunningApplicationsState. */
export type ProcessMonitorState = RunningApplicationsState;

/** The running-applications monitor's status, as pushed to the config window. Always names its platform. */
export interface ProcessMonitorStatus extends RunningApplicationsStatus {
  Platform: string;
}

/** Where reconnecting to (or rediscovering) the server has got to. */
export type ServerRecoveryState =
  | 'idle'
  | 'ConnectingPrimary'
  | 'Discovering'
  | 'PrimaryFailed'
  | 'ValidatingIdentity'
  | 'Reconnected'
  | 'RecoveryFailed';

/** Running totals shown in the recovery panel. Timestamps are ms since epoch, 0 for never. */
export interface ServerRecoveryMetrics {
  Attempts: number;
  LastAttemptAt: number;
  LastFailureAt: number;
  LastFailureReason: string | null;
  LastRecoveredAt: number;
  /** Null: recovery retries for as long as the server is away. */
  MaxAttempts: number | null;
  CooldownMs: number;
}

/** Progress of reconnecting to (or rediscovering) the server. */
export interface ServerRecoveryStatus {
  State: ServerRecoveryState;
  Message?: string;
  /** Added to every status the main process pushes; absent from the initial idle status. */
  Metrics?: ServerRecoveryMetrics;
}

/** Everything the config window needs to paint its first frame (`Loaded`). */
export interface LoadedSnapshot {
  Profile: ClientProfile;
  ProcessMonitorStatus: ProcessMonitorStatus;
  ServerRecoveryStatus: ServerRecoveryStatus;
  /** Null until the updater has reported anything. */
  AppUpdateStatus: AppUpdateStatus | null;
  UpdateChannel: UpdateChannel;
}

// ---- Channels ---------------------------------------------------------------

/**
 * The config window's invoke channels: what each takes from the renderer and
 * answers. The main process (src/main/ipc-handlers.ts) registers these.
 */
export interface InvokeMap {
  Loaded: { Args: []; Result: IpcResult<LoadedSnapshot> };
  /** A bare version string, not a tuple. */
  GetVersion: { Args: []; Result: string };
  Shutdown: { Args: []; Result: IpcResult<true> };
  /** Hides the config window (the Client keeps running in the tray). */
  Minimise: { Args: []; Result: IpcResult<true> };
  /** Resets the profile, update channel, scripts and show variables, then restarts the service. */
  'Profile:FactoryReset': { Args: []; Result: IpcResult<true> };
  'Profile:SetManualServer': { Args: [Host: string, Port: number]; Result: IpcResult<true> };
  'Profile:ClearManualServer': { Args: []; Result: IpcResult<true> };
  'AppUpdate:Check': { Args: []; Result: IpcResult<true> };
  'AppUpdate:Install': { Args: []; Result: IpcResult<true> };
  /** Applies from the next update check. Answers the channel now in force. */
  'AppUpdate:SetChannel': { Args: [Channel: UpdateChannel]; Result: IpcResult<UpdateChannel> };
}

/** The config window's invoke allowlist (INVOKE_CHANNELS in src/preload.ts). */
export type InvokeChannel = keyof InvokeMap;

/** Invoke channels the overlay windows use, each through its own preload. */
export interface OverlayInvokeMap {
  /** The operator dismissed the identify overlay (Escape or a click). */
  'Identify:Close': { Args: []; Result: IpcResult<true> };
  /** The operator aborted the pending run-on-launch script (Cancel, Escape or Shift). */
  'LaunchCountdown:Cancel': { Args: []; Result: IpcResult<true> };
}

export type OverlayInvokeChannel = keyof OverlayInvokeMap;

/** What the main process pushes to the config window, channel by channel (arguments in order). */
export interface PushMap {
  SetProfile: [Profile: ClientProfile];
  'AppUpdate:Status': [Status: AppUpdateStatus];
  ProcessMonitorStatus: [Status: ProcessMonitorStatus];
  ServerRecoveryStatus: [Status: ServerRecoveryStatus];
}

/** The config window's subscribe allowlist (SUBSCRIBE_CHANNELS in src/preload.ts). */
export type PushChannel = keyof PushMap;

// ---- Bridges ----------------------------------------------------------------

/** `window.API` in the config window (src/preload.ts). */
export interface ClientPreloadAPI {
  Loaded(): Promise<IpcResult<LoadedSnapshot>>;
  GetVersion(): Promise<string>;
  Shutdown(): Promise<IpcResult<true>>;
  Minimise(): Promise<IpcResult<true>>;
  ResetClientFactoryDefaults(): Promise<IpcResult<true>>;
  SetManualServer(Host: string, Port: number): Promise<IpcResult<true>>;
  ClearManualServer(): Promise<IpcResult<true>>;
  CheckForAppUpdates(): Promise<IpcResult<true>>;
  /** Choose the update channel; applies from the next check. */
  SetUpdateChannel(Channel: UpdateChannel): Promise<IpcResult<UpdateChannel>>;
  InstallAppUpdate(): Promise<IpcResult<true>>;
  OnAppUpdateStatus(callback: (status: AppUpdateStatus) => void): Unsubscribe;
  OnProcessMonitorStatus(callback: (status: ProcessMonitorStatus) => void): Unsubscribe;
  OnServerRecoveryStatus(callback: (status: ServerRecoveryStatus) => void): Unsubscribe;
  SetProfile(callback: (profile: ClientProfile) => void): Unsubscribe;
}

/**
 * Which channel each ClientPreloadAPI method uses: what src/preload.ts
 * implements. Invoke methods answer with InvokeMap[channel]['Result']; the
 * callbacks of subscribe methods receive PushMap[channel].
 */
export interface ClientPreloadChannels {
  Loaded: 'Loaded';
  GetVersion: 'GetVersion';
  Shutdown: 'Shutdown';
  Minimise: 'Minimise';
  ResetClientFactoryDefaults: 'Profile:FactoryReset';
  SetManualServer: 'Profile:SetManualServer';
  ClearManualServer: 'Profile:ClearManualServer';
  CheckForAppUpdates: 'AppUpdate:Check';
  SetUpdateChannel: 'AppUpdate:SetChannel';
  InstallAppUpdate: 'AppUpdate:Install';
  OnAppUpdateStatus: 'AppUpdate:Status';
  OnProcessMonitorStatus: 'ProcessMonitorStatus';
  OnServerRecoveryStatus: 'ServerRecoveryStatus';
  SetProfile: 'SetProfile';
}

/** `window.IdentifyAPI` in the identify overlay windows (src/identify-preload.ts). */
export interface IdentifyPreloadAPI {
  Close(): Promise<IpcResult<true>>;
}

/** `window.LaunchCountdownAPI` in the launch countdown window (src/launch-countdown-preload.ts). */
export interface LaunchCountdownPreloadAPI {
  Cancel(): Promise<IpcResult<true>>;
}

// ---- Overlay query strings --------------------------------------------------
//
// The overlay windows get their data in the URL the main process loads them
// with, not over IPC. Every value arrives as a string, and a page must treat it
// as untrusted (parse defensively, fall back when it is missing).

/** The machine details the identify overlay shows: the JSON in its `data` parameter. */
export interface IdentifyOverlayDetails {
  /** Empty when unknown. */
  Hostname: string;
  /** Empty when the server sent none; the page then shows the hostname. */
  Nickname: string;
  IPs: string[];
}

/** The identify overlay window's query string (one window per display). */
export interface IdentifyOverlayQuery {
  /** JSON of IdentifyOverlayDetails. */
  data: string;
  /** "Screen <n> (<width>x<height>)", in native pixels. */
  resolutionLabel: string;
  /** The display's 1-based position (matches ClientDisplay.ScreenNumber). */
  screenNumber: string;
}

/** The launch countdown window's query string. */
export interface LaunchCountdownQuery {
  /** The run-on-launch script's name. */
  script: string;
  /** Whole seconds before it runs; the main process holds the real timer. */
  seconds: string;
}
