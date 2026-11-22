// ShowTrak Timers: the timer as every surface sees it. Pushed from the main
// process to the desktop renderer (IPC), and the source of what the Web
// Dashboard is sent (see dashboard.d.ts).
//
// The constants and normalisers that go with these (TIMER_TYPES,
// NormalizeTimerType, ComputeTimerDisplay ...) are runtime code and stay in the
// Timers repo (src/common/timers.ts), typed against these declarations.

/** CLOCK is a World Clock: the host computer's time of day, always running, with no run controls. */
export type TimerType = 'TIMER' | 'COUNTDOWN' | 'STOPWATCH' | 'CLOCK';

/** How a World Clock shows the time. */
export type ClockFormat = '24H' | '12H';

/** OVERRUN is a timer still running past its duration (EndBehaviour OVERRUN). */
export type TimerStatus = 'STANDBY' | 'RUNNING' | 'PAUSED' | 'COMPLETE' | 'OVERRUN';

/**
 * What a Timer or Countdown does when it reaches its duration:
 *   - HOLD: stop there and show it as complete (the 1.x behaviour);
 *   - OVERRUN: keep counting past it, shown as +mm:ss;
 *   - RESET: go straight back to standby;
 *   - LOOP: start again from zero.
 */
export type EndBehaviour = 'HOLD' | 'OVERRUN' | 'RESET' | 'LOOP';

/** The editable configuration of a timer (what is stored in the show file). */
export interface TimerConfig {
  ID: number;
  Type: TimerType;
  Name: string;
  Description: string;
  /**
   * Milliseconds; null for stopwatches and World Clocks, and for a Timer given
   * no duration (it then counts up with no end, as in 1.x).
   */
  Duration: number | null;
  Weight: number;
  ShowOnWeb: boolean;
  EndBehaviour: EndBehaviour;
  /** "builtin:<name>", "asset:<id>", or null for none. */
  CompletionSound: string | null;
  CompletionToast: boolean;
  /** Warn this many milliseconds before the end; null for no warning. */
  WarningMs: number | null;
  WarningSound: string | null;
  WarningToast: boolean;
  /** Show hundredths of a second (mm:ss.cc). */
  ShowHundredths: boolean;
  /** 12 or 24 hour time, for a World Clock (kept, but unused, by other types). */
  ClockFormat: ClockFormat;
  /** The group the timer is in; null for the Default group. */
  GroupID: number | null;
}

/**
 * A timer as pushed to the renderers: its configuration plus its run state at
 * the moment the snapshot was taken. Surfaces animate a RUNNING/OVERRUN timer
 * locally from ElapsedMs, re-anchoring on every push.
 */
export interface TimerView extends TimerConfig {
  Status: TimerStatus;
  /**
   * Elapsed running time when the snapshot was taken. For a World Clock, the
   * host's time of day (ms since its local midnight), so every surface shows
   * the host's clock rather than its own.
   */
  ElapsedMs: number;
  /** True while inside the warning window before the end. */
  Warning: boolean;
}
