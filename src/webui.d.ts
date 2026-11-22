// The `/ui` Socket.IO namespace: how ShowTrak Server's Web UI reaches the
// server. The Web UI is the Server's own renderer, served by the Server to a
// browser, so both ends always come from the same release.
//
// On top of the events below, a signed-in browser is sent the desktop
// renderer's pushes on their own channel names, with the payloads its
// `window.API` subscriptions receive (see ShowTrakAPI), less the desktop-only
// ones. Calls go through `rpc` to the same handlers the desktop invokes.

import type { AppMode } from './app';
import type {
  LogConsoleSnapshot,
  MonitorLiveLevelsSnapshot,
  MonitorTileLevelsSnapshot,
} from './views';

/** The handshake `auth`: the session token an earlier sign-in returned, if any. */
export interface WebUiHandshakeAuth {
  token?: string;
}

/**
 * What the browser is told about the Web UI, never the passcode itself: on
 * connect and whenever the Web UI settings change ('hello'), and on request
 * ('config:get'). The Allow* flags and the two *Enabled ones only decide what
 * the page offers; the server checks every call regardless.
 */
export interface WebUiConfig {
  Enabled: boolean;
  /** A passcode is required (protection is on and one is set). */
  PasswordProtection: boolean;
  AllowRemoteScripts: boolean;
  /** Wake-on-LAN is on server-wide and allowed for the Web UI. */
  WOLEnabled: boolean;
  /** Unassigned slots are on server-wide and allowed for the Web UI. */
  UnassignedClientsEnabled: boolean;
  AllowModeChange: boolean;
  AllowAlertActionsToggle: boolean;
  AllowClientManagement: boolean;
  AllowMonitoringManagement: boolean;
  /** This connection may act: signed in, or no passcode is required. */
  Authed: boolean;
  Mode: AppMode;
  /** The server's version. */
  Version: string;
}

/**
 * Why a request was refused. 'unauthorized' means sign in first; 'forbidden'
 * and 'edit_mode_required' are the channel authorisation's answers (as for
 * `/sdk`'s rpc).
 */
export type WebUiError =
  | 'unauthorized'
  | 'forbidden'
  | 'edit_mode_required'
  | 'invalid_channel'
  | 'unknown_channel'
  | 'failed';

/** The answer to a request that returns a value: the value, or why not. */
export type WebUiResponse<T> =
  { result: T; error?: undefined } | { result?: undefined; error: WebUiError };

/** The answer to 'auth:login'. The token signs the browser back in on reconnect. */
export type WebUiLoginResponse =
  | { ok: true; token: string; error?: undefined }
  | { ok?: undefined; error: 'disabled' | 'invalid_password' | 'failed' }
  /** Too many wrong passcodes from this address; try again after retryAfterMs. */
  | { ok?: undefined; error: 'rate_limited'; retryAfterMs: number };

/** The answer to 'config:get'. */
export type WebUiConfigResponse =
  { data: WebUiConfig; error?: undefined } | { data?: undefined; error: 'failed' };

/** The answer to 'auth:logout'. */
export type WebUiLogoutResponse =
  { ok: true; error?: undefined } | { ok?: undefined; error: 'failed' };

/** Events the browser sends. */
export interface WebUiClientToServerEvents {
  'auth:login': (
    payload: { password?: string } | undefined,
    ack: (response: WebUiLoginResponse) => void
  ) => void;
  'auth:logout': (ack: (response: WebUiLogoutResponse) => void) => void;
  'config:get': (ack: (response: WebUiConfigResponse) => void) => void;
  /** Send the whole current state again (after a reconnect). */
  'bootstrap:get': () => void;
  /** Call one of the Server's IPC channels, with `args` spread into it. */
  rpc: (channel: string, args: unknown[], ack: (response: WebUiResponse<unknown>) => void) => void;
  /** Stream the server log to this browser, at and above `level`, until closed. */
  'logconsole:open': (
    level: string,
    ack: (response: WebUiResponse<LogConsoleSnapshot>) => void
  ) => void;
  'logconsole:close': () => void;
  /** Stream one monitor's live meters to this browser until closed. */
  'monitorlive:open': (
    targetId: number,
    ack: (response: WebUiResponse<MonitorLiveLevelsSnapshot>) => void
  ) => void;
  'monitorlive:close': () => void;
  /** Stream the dashboard tiles' meters to this browser until closed. */
  'monitortiles:open': (ack: (response: WebUiResponse<MonitorTileLevelsSnapshot>) => void) => void;
  'monitortiles:close': () => void;
  'rainbow:get': (ack: (response: WebUiResponse<boolean>) => void) => void;
  'rainbow:set': (enabled: boolean, ack: (response: WebUiResponse<boolean>) => void) => void;
}

/** The event only the Web UI is sent (beside the renderer's pushes; see the top of this file). */
export interface WebUiServerToClientEvents {
  hello: (config: WebUiConfig) => void;
}
