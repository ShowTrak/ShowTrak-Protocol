'use strict';
// Reading and seeding a ShowTrak Server database with Node's built-in SQLite
// (node:sqlite, Node 22.5+), so the harness needs no native module or sqlite3 CLI.
const fs = require('node:fs');

let DatabaseSync;
function load() {
  if (!DatabaseSync) {
    // node:sqlite prints an ExperimentalWarning on first use; it is noise here.
    const emit = process.emitWarning;
    process.emitWarning = (warning, ...rest) => {
      if (String(warning).includes('SQLite')) return;
      emit.call(process, warning, ...rest);
    };
    ({ DatabaseSync } = require('node:sqlite'));
  }
  return DatabaseSync;
}

function withDb(file, fn, { readOnly = false } = {}) {
  const Database = load();
  const db = new Database(file, { readOnly });
  try {
    db.exec('PRAGMA busy_timeout = 5000;');
    return fn(db);
  } finally {
    db.close();
  }
}

// A row from the server's settings table, or null (also while the DB does not
// exist yet or is locked).
function setting(file, key) {
  if (!fs.existsSync(file)) return null;
  try {
    return withDb(
      file,
      (db) => {
        const row = db.prepare('SELECT Value AS v FROM settings WHERE Key = ?').get(key);
        return row && row.v ? String(row.v) : null;
      },
      { readOnly: true }
    );
  } catch {
    return null;
  }
}

module.exports = { withDb, setting };
