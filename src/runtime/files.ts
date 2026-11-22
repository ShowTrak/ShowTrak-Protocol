// File writes that have to survive a power cut.
//
// ShowTrak Server and ShowTrak Timers save settings, show files and their other
// state by writing a temp file and renaming it over the real one, so a crash
// mid-write never leaves a half-written file. The rename alone is not enough:
// it can reach the disk before the data does, and a power cut in between
// leaves the renamed file empty. Each app had this helper in its Utils.
import fs from 'fs';

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
