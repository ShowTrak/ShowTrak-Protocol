// ShowTrak Timers: the Web Dashboard's Socket.IO wire, between the app
// (src/Modules/WebDashboard) and the browsers that open it.
//
// Two kinds of reader, and both outlive the host they talk to:
//   - the dashboard page the app serves, which a service worker may cache, so
//     a page can be older or newer than the host answering it;
//   - pages built against 1.x's socket (a graphics overlay, a custom display),
//     which the socket stays open to: cross-origin, like 1.x, and with no
//     passcode set, timers arrive straight after connecting, with no login.
// So a browser must treat every payload as untrusted and normalise it, and the
// host must keep sending the fields 1.x sent (noted below).

import type { ClockFormat, EndBehaviour, TimerStatus, TimerType } from './timers';

/**
 * A timer as sent to dashboard browsers ('timers:update'): only the timers with
 * ShowOnWeb, by Weight then ID. The readable strings are pre-formatted by the
 * host for 1.x pages; the dashboard itself animates from ElapsedMs.
 */
export interface DashboardTimer {
  ID: number;
  Weight: number;
  Type: TimerType;
  Name: string;
  Description: string;
  /** Milliseconds; null for stopwatches and World Clocks. */
  Duration: number | null;
  /** The duration as mm:ss or hh:mm:ss ('00:00' when there is none). Sent since 1.x. */
  TotalTimeReadable: string;
  Status: TimerStatus;
  /** 2.0+. */
  EndBehaviour: EndBehaviour;
  /** Elapsed time when the push was made (a World Clock's host time of day). 2.0+. */
  ElapsedMs: number;
  /** Inside the warning window before the end. 2.0+. */
  Warning: boolean;
  /** 2.0+. */
  ShowHundredths: boolean;
  /** 12 or 24 hour time, for a World Clock. 2.0.2+. */
  ClockFormat: ClockFormat;
  /** The timer's group; null for the Default group. 2.0+. */
  GroupID: number | null;
  /** The run state in 1.x's shape, kept for pages built against it. */
  State: {
    ElapsedTime: number;
    ElapsedTimeReadable: string;
    /** Null for timers with no duration. */
    RemainingMs: number | null;
    RemainingReadable: string | null;
  };
}

/**
 * A group as sent to dashboard browsers ('groups:update'): only the groups
 * holding at least one timer on show. 2.0+.
 */
export interface DashboardGroup {
  GroupID: number;
  Title: string;
  Weight: number;
  /** Index into the shared eight-colour palette, or null for an untinted box. */
  Colour: number | null;
  /** The group's width on the column grid, as the desktop lays it out. */
  isFullWidth: boolean;
  ColumnSpan: number;
}

/** The desktop's group layout ('layout:update'), so the dashboard lays groups out the same way. 2.0+. */
export interface DashboardLayout {
  /** UI_GROUP_COLUMN_COUNT. */
  GroupColumns: number;
  /** How strongly group colours tint, 0-100. */
  GroupColourSaturation: number;
}

/** What a browser is told on connecting, and again when the passcode changes. 2.0+. */
export interface DashboardHello {
  Name: string;
  Version: string;
  PasswordProtection: boolean;
  /** Already admitted: no passcode is needed (or the browser signed in on this socket). */
  Authed: boolean;
}

/**
 * A sign-in ('auth:login'): the 4-digit passcode, or the token an earlier
 * sign-in returned. The host reads only a string `password`; anything else is
 * not a passcode.
 */
export type DashboardLoginRequest = { password: string } | { token: string };

/**
 * The answer to a sign-in. `token` is returned while a passcode is in force;
 * keep it instead of the passcode. A wrong token is answered
 * 'invalid_password' too, and is not counted as a guess.
 */
export type DashboardLoginResult =
  | { ok: true; token?: string }
  | { error: 'invalid_password' }
  | { error: 'rate_limited'; retryAfterMs: number };

/** Events the host sends to dashboard browsers. Timer data only ever goes to admitted browsers. */
export interface WebDashboardServerToClientEvents {
  hello: (hello: DashboardHello) => void;
  'layout:update': (layout: DashboardLayout) => void;
  'groups:update': (groups: DashboardGroup[]) => void;
  'timers:update': (timers: DashboardTimer[]) => void;
  /** How many browsers are watching. Sent since 1.x. */
  'clients:count': (payload: { count: number }) => void;
}

/** Events dashboard browsers send to the host. */
export interface WebDashboardClientToServerEvents {
  'auth:login': (
    credentials: DashboardLoginRequest,
    ack: (result: DashboardLoginResult) => void
  ) => void;
}
