// Logging primitives shared by ShowTrakServer and ShowTrakClient.
//
// WHAT IS HERE, AND WHY ONLY THIS
//
// The two apps' Loggers are not interchangeable, and deliberately so: the Server
// queues asynchronous appends (ordering via a promise chain, no sync I/O on a
// busy show machine), while the Client writes with appendFileSync because an
// unattended agent that crashes must not lose the lines that explain why. That
// is a durability-vs-throughput decision per app, not duplication, so the SINKS
// stay in each app.
//
// What was genuinely duplicated is everything below: how a level is ranked and
// gated, how the default level is derived, and the formatting helpers. That is
// also exactly where the two copies drifted — the Server derived its default
// from NODE_ENV alone, which a packaged Electron app never sets, so every
// shipped Server logged at 'debug' forever while its settings UI read 'info'.
// The Client had already fixed that; the Server had not. Deriving it in one
// place is the point of this module.

/** Severity ordering. A message is emitted when its rank <= the active level. */
export const LEVEL_RANK: Readonly<Record<string, number>> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4,
};

export interface DefaultLevelInputs {
  /** process.env.NODE_ENV */
  nodeEnv?: string | undefined;
  /**
   * Whether this is a shipped build.
   *
   * Callers pass `!process.defaultApp`: Electron sets `defaultApp` only when the
   * app was launched from a checkout (`electron .`), so its ABSENCE is the
   * "packaged" signal — the same test `app.isPackaged` performs. It is passed in
   * rather than read here so this module stays loadable outside Electron (both
   * apps' test suites load their Logger directly).
   */
  isPackagedBuild: boolean;
}

/**
 * The level to use when LOG_LEVEL is not set.
 *
 * Packaged builds and NODE_ENV=production both mean "shipped": log at 'info', so
 * a machine in the field is not writing debug chatter into the file an operator
 * will later be asked to send back. Anything else is a developer checkout, which
 * gets 'debug'.
 */
export function ResolveDefaultLevel({ nodeEnv, isPackagedBuild }: DefaultLevelInputs): string {
  return nodeEnv === 'production' || isPackagedBuild ? 'info' : 'debug';
}

/**
 * Whether `level` should be emitted given the currently active level.
 *
 * Unknown active levels fall back to `fallbackLevel`; an unknown message level
 * is treated as 'info', so a typo degrades to "still logged" rather than to
 * silence.
 */
export function IsLevelEnabled(level: string, activeLevel: string, fallbackLevel: string): boolean {
  const want = LEVEL_RANK[activeLevel] ?? LEVEL_RANK[fallbackLevel] ?? 0;
  const have = LEVEL_RANK[level] ?? LEVEL_RANK.info ?? 0;
  return have <= want;
}

/** Fixed-width upper-case tag segment, so log columns line up. */
export function Pad(text: string, length = 17): string {
  return text.padEnd(length, ' ').toUpperCase();
}

// The ANSI escape introducer is the point of this pattern.
// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\x1b\[[0-9;]*m/g;

/** Strip colour codes, so the file copy of a line stays readable. */
export function StripAnsi(value: string): string {
  if (typeof value !== 'string') return value;
  return value.replace(ANSI_REGEX, '');
}

/** `YYYY-MM-DD`, used to name the daily log file. */
export function GetDatestampLabel(date: Date = new Date()): string {
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `YYYY-MM-DD HH:mm:ss`, the per-line timestamp. */
export function GetDateTimeStamp(date: Date = new Date()): string {
  const pad = (v: number) => String(v).padStart(2, '0');
  return (
    `${GetDatestampLabel(date)} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/**
 * Render an arbitrary logged argument as a string for the file sink.
 *
 * Errors keep their stack (the thing you actually need), strings pass through,
 * and anything else is JSON — falling back to String() for values JSON refuses,
 * such as a circular object or a BigInt.
 */
export function SerializeArg(arg: unknown): string {
  if (arg instanceof Error) return arg.stack || String(arg);
  if (typeof arg === 'string') return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}
