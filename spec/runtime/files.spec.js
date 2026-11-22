// src/runtime/files.ts: the apps' write-then-rename saves (settings, show
// files, the dashboard key): ReplaceFileSync, and WriteAndSyncFileSync, its
// write half.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { WriteAndSyncFileSync, ReplaceFileSync } = require('../../dist/runtime/files');

function tempDir(t) {
  const Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-protocol-files-'));
  t.after(() => fs.rmSync(Dir, { recursive: true, force: true }));
  return Dir;
}

test('writes the text as UTF-8, replacing what was there', (t) => {
  const File = path.join(tempDir(t), 'settings.json.tmp');
  fs.writeFileSync(File, 'a much longer previous content that must not survive');
  WriteAndSyncFileSync(File, '{"Name":"Ünïcode ✓"}');
  assert.equal(fs.readFileSync(File, 'utf8'), '{"Name":"Ünïcode ✓"}');
});

test('flushes through the descriptor it opened, and closes it even when the write fails', (t) => {
  const File = path.join(tempDir(t), 'show.tmp');
  const Calls = [];
  for (const Name of ['openSync', 'writeSync', 'fsyncSync', 'closeSync']) {
    const Real = fs[Name];
    t.mock.method(fs, Name, (...Args) => {
      Calls.push(Name);
      return Real(...Args);
    });
  }
  WriteAndSyncFileSync(File, 'x');
  assert.deepEqual(Calls, ['openSync', 'writeSync', 'fsyncSync', 'closeSync']);

  Calls.length = 0;
  fs.writeSync.mock.mockImplementation(() => {
    Calls.push('writeSync');
    throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' });
  });
  assert.throws(() => WriteAndSyncFileSync(File, 'y'), /ENOSPC/);
  assert.deepEqual(Calls, ['openSync', 'writeSync', 'closeSync']);
});

test('a folder that does not exist is an error, not a silent no-op', (t) => {
  const File = path.join(tempDir(t), 'missing', 'file.tmp');
  assert.throws(() => WriteAndSyncFileSync(File, 'x'), { code: 'ENOENT' });
});

test('ReplaceFileSync swaps the whole file in, creating its folder, and leaves no temp file', (t) => {
  const Dir = tempDir(t);
  const File = path.join(Dir, 'Settings', 'install.json');
  ReplaceFileSync(File, '{"A":1}');
  assert.equal(fs.readFileSync(File, 'utf8'), '{"A":1}');
  ReplaceFileSync(File, '{}');
  assert.equal(fs.readFileSync(File, 'utf8'), '{}');
  assert.deepEqual(fs.readdirSync(path.dirname(File)), ['install.json']);
});

test('ReplaceFileSync writes the temp file beside the real one, flushed, then renames it', (t) => {
  const File = path.join(tempDir(t), 'show.showtrak');
  fs.writeFileSync(File, 'old');
  const Steps = [];
  const RealFsync = fs.fsyncSync;
  t.mock.method(fs, 'fsyncSync', (Fd) => {
    Steps.push('fsync');
    return RealFsync(Fd);
  });
  const RealRename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (From, To) => {
    Steps.push(['rename', From, To]);
    return RealRename(From, To);
  });
  ReplaceFileSync(File, 'new');
  assert.deepEqual(Steps, ['fsync', ['rename', `${File}.tmp`, File]]);
});

test('ReplaceFileSync leaves the old file whole when the write fails', (t) => {
  const File = path.join(tempDir(t), 'show.showtrak');
  fs.writeFileSync(File, 'old');
  t.mock.method(fs, 'writeSync', () => {
    throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' });
  });
  assert.throws(() => ReplaceFileSync(File, 'new'), /ENOSPC/);
  t.mock.restoreAll();
  assert.equal(fs.readFileSync(File, 'utf8'), 'old');
});
