// Spec helper: a logger that records every line, for the shared modules that
// take an app's logger (`CreateLogger(alias)`) as an argument.
function createLoggerStub() {
  const entries = [];
  const record =
    (level) =>
    (...args) => {
      entries.push({
        level,
        args,
        text: args.map((A) => (A instanceof Error ? A.message : String(A))).join(' '),
      });
    };
  return {
    entries,
    logger: {
      log: record('log'),
      info: record('info'),
      warn: record('warn'),
      error: record('error'),
      debug: record('debug'),
      success: record('success'),
    },
    /** The text of every line logged at `level` (all levels when omitted). */
    lines(level) {
      return entries.filter((E) => !level || E.level === level).map((E) => E.text);
    },
    clear() {
      entries.length = 0;
    },
  };
}

module.exports = { createLoggerStub };
