// The log levels, in order of severity: what every ShowTrak logger gates its
// lines on (../runtime/logging, which re-exports this), and what a page that
// filters log lines by level ranks them by (ShowTrak Server's log console, in
// its renderer). One table, so a level a page shows and a level a logger writes
// always rank the same.

/** Severity ordering. A message is emitted when its rank <= the active level. */
export const LEVEL_RANK: Readonly<Record<string, number>> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4,
};
