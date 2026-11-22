// src/runtime/files.ts: WriteAndSyncFileSync, the write half of the apps'
// write-then-rename saves (settings, show files, the dashboard key).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { WriteAndSyncFileSync } = require('../../dist/runtime/files');

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
