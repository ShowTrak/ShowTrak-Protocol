// File writes that have to survive a power cut.
//
// ShowTrak Server and ShowTrak Timers save settings, show files and their other
// state by writing a temp file and renaming it over the real one, so a crash
// mid-write never leaves a half-written file. The rename alone is not enough:
// it can reach the disk before the data does, and a power cut in between
// leaves the renamed file empty. Each app had this helper in its Utils, and
// the steps around it (make the folder, write the temp file beside the real
// one, rename) at each call site.
import fs from 'fs';
import path from 'path';

/**
 * Write a text file and flush it to the disk before returning. For the temp
 * file of a write-then-rename: without the flush, a power cut can leave the
 * renamed file empty, because the rename can reach the disk before the data.
 */
export function WriteAndSyncFileSync(FilePath: string, Text: string): void {
  const Fd = fs.openSync(FilePath, 'w');
  try {
    fs.writeSync(Fd, Text, null, 'utf8');
    fs.fsyncSync(Fd);
  } finally {
    fs.closeSync(Fd);
  }
}

/**
 * Replace a file's contents so that a crash mid-write leaves the old file or the
 * new one, never a torn one: the text goes to `<FilePath>.tmp`, flushed to the
 * disk, which is then renamed over the file. Creates the folder when missing.
 * Throws when any step fails (a leftover .tmp is overwritten next time).
 */
export function ReplaceFileSync(FilePath: string, Text: string): void {
  fs.mkdirSync(path.dirname(FilePath), { recursive: true });
  const TempPath = `${FilePath}.tmp`;
  WriteAndSyncFileSync(TempPath, Text);
  fs.renameSync(TempPath, FilePath);
}
