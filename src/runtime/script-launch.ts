// Running a script file, the same way on ShowTrak Server and ShowTrak Client.
//
// A script runs on a client when the server dispatches it, and on the server
// machine itself when the operator runs it locally from the script manager.
// Each app had its own copy of the launcher table and of the check that keeps a
// script's paths inside its folder, and the copies drifted:
//   - an extensionless file went to /bin/sh on the Client but was run directly
//     on the Server;
//   - a .zsh script ran under bash on the Server, and was run directly on the
//     Client;
//   - the Server checked containment more loosely (it allowed a `..` that came
//     back inside the folder) and resolved a Windows-style `bin\run.sh` as a
//     literal file name, where the Client turned it into `bin/run.sh`.
// So the same script could work on one and fail on the other. This is the one
// copy, with the stricter of each rule.
import fs from 'fs';
import path from 'path';

/** How to start a script: the program, and the arguments before the script's own. */
export interface ScriptLauncher {
  command: string;
  args: string[];
}

/** Reads the first bytes of a file, or null when it cannot be read. */
export type ReadFileHead = (FilePath: string) => Buffer | null;

const HEAD_BYTES = 512;

function ReadHead(FilePath: string): Buffer | null {
  let Fd: number | null = null;
  try {
    Fd = fs.openSync(FilePath, 'r');
    const Buffer_ = Buffer.alloc(HEAD_BYTES);
    const Read = fs.readSync(Fd, Buffer_, 0, HEAD_BYTES, 0);
    return Buffer_.subarray(0, Read);
  } catch {
    return null;
  } finally {
    if (Fd !== null) {
      try {
        fs.closeSync(Fd);
      } catch {
        // Nothing to do: the read already succeeded or failed.
      }
    }
  }
}

/**
 * Whether an extensionless file should be executed directly rather than handed
 * to /bin/sh: it starts with a `#!` line (which names its own interpreter), or
 * it is a binary (a NUL byte in its first bytes). A plain text file without a
 * shebang, an empty file, or one that cannot be read goes to /bin/sh, which is
 * what a shell would do with it.
 */
function RunsDirectly(Head: Buffer | null): boolean {
  if (!Head || Head.length === 0) return false;
  if (Head.length >= 2 && Head[0] === 0x23 && Head[1] === 0x21) return true;
  return Head.includes(0);
}

/**
 * Resolve how to launch a script file, from its extension and the platform.
 *
 * Windows: .bat/.cmd through cmd, .ps1 through PowerShell with the execution
 * policy bypassed (the default policy blocks unsigned scripts outright), .exe
 * directly, anything else through cmd so the file associations apply.
 *
 * macOS and Linux: .sh/.command through /bin/sh, .bash through bash, .zsh
 * through zsh, .py through python3, .js through node. An extensionless file is
 * executed directly when it has a shebang or is a binary, and otherwise run by
 * /bin/sh. Any other extension is executed directly (a binary, or a script with
 * a shebang); the caller marks it executable first.
 *
 * `Platform` and `ReadHead` are for tests; they default to the running process
 * (read when called, not when loaded) and the file on disk.
 */
export function ResolveScriptLauncher(
  ScriptPath: string,
  Platform: NodeJS.Platform = process.platform,
  ReadFileHead: ReadFileHead = ReadHead
): ScriptLauncher {
  // The posix flavour reads a Windows path's extension correctly too, and the
  // win32 one would split a POSIX file name on a backslash in it.
  const Extension = (Platform === 'win32' ? path.win32 : path.posix)
    .extname(ScriptPath)
    .toLowerCase();

  if (Platform === 'win32') {
    switch (Extension) {
      case '.bat':
      case '.cmd':
        return { command: 'cmd.exe', args: ['/c', ScriptPath] };
      case '.ps1':
        return {
          command: 'powershell.exe',
          args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ScriptPath],
        };
      case '.exe':
        return { command: ScriptPath, args: [] };
      default:
        return { command: 'cmd.exe', args: ['/c', ScriptPath] };
    }
  }

  switch (Extension) {
    case '.sh':
    case '.command':
      return { command: '/bin/sh', args: [ScriptPath] };
    case '.bash':
      return { command: '/bin/bash', args: [ScriptPath] };
    case '.zsh':
      // From PATH: /bin/zsh on macOS, /usr/bin/zsh on most Linux.
      return { command: 'zsh', args: [ScriptPath] };
    case '.py':
      return { command: 'python3', args: [ScriptPath] };
    case '.js':
      return { command: 'node', args: [ScriptPath] };
    case '':
      return RunsDirectly(ReadFileHead(ScriptPath))
        ? { command: ScriptPath, args: [] }
        : { command: '/bin/sh', args: [ScriptPath] };
    default:
      return { command: ScriptPath, args: [] };
  }
}

/**
 * Normalize a script-relative path however it was authored: backslashes become
 * forward slashes (which Node joins correctly on every platform) and leading
 * "./" segments go. Anything that is not a string reads as ''.
 */
export function NormalizeScriptRelativePath(Value: unknown): string {
  if (typeof Value !== 'string') return '';
  let Normalized = Value.trim().replace(/\\/g, '/');
  while (Normalized.startsWith('./')) Normalized = Normalized.slice(2);
  return Normalized.trim();
}

/**
 * Whether a relative path is safe to join onto a folder we own.
 *
 * Rejected: empty, NUL bytes, absolute paths, UNC paths, drive letters, and any
 * `..` component under EITHER separator, even one that would come back inside
 * the folder. Both spellings matter: a Windows-style `..\evil` is an ordinary
 * file name to POSIX `path.resolve`, but NormalizeScriptRelativePath turns it
 * into a real traversal on every platform.
 */
export function IsSafeRelativePath(Value: unknown): boolean {
  if (typeof Value !== 'string') return false;
  const Raw = Value.trim();
  if (!Raw || Raw.includes('\0')) return false;
  const Unified = Raw.replace(/\\/g, '/');
  // A leading '/' covers both POSIX absolute paths and UNC ('\\host\share').
  if (Unified.startsWith('/')) return false;
  if (/^[a-zA-Z]:/.test(Unified)) return false;
  return !Unified.split('/').includes('..');
}

/**
 * Resolve relative path segments inside `Base`, or null when any of them is
 * unsafe (see IsSafeRelativePath) or the result is not strictly inside `Base`
 * (the folder itself is refused too).
 */
export function ResolveContainedPath(Base: string, ...Segments: string[]): string | null {
  if (typeof Base !== 'string' || !Base) return null;
  if (!Segments.every(IsSafeRelativePath)) return null;
  let Root: string;
  let Resolved: string;
  try {
    Root = path.resolve(Base);
    Resolved = path.resolve(Root, ...Segments.map((Segment) => Segment.trim()));
  } catch {
    return null;
  }
  // A second, independent gate: the segment checks should already have caught
  // anything that escapes.
  if (Resolved === Root) return null;
  return Resolved.startsWith(Root + path.sep) ? Resolved : null;
}

/** Whether a script ID can name a folder: one safe path segment, no separator. */
export function IsSafeScriptID(ID: unknown): ID is string {
  return typeof ID === 'string' && IsSafeRelativePath(ID) && !/[\\/]/.test(ID.trim());
}

/**
 * Resolve a script's folder inside the scripts directory. The ID is a folder
 * name (the Server lists its scripts directory to build the catalog), so it
 * must be a single safe segment. Null when it is not.
 */
export function ResolveScriptFolder(ScriptsDirectory: string, ID: unknown): string | null {
  if (!IsSafeScriptID(ID)) return null;
  return ResolveContainedPath(ScriptsDirectory, ID);
}

/**
 * Resolve a file inside a script's folder: the ID must be a safe folder name and
 * the relative path, normalized first, must stay strictly inside that folder.
 * Null when either fails. Whether the file exists is the caller's to check.
 */
export function ResolveScriptFile(
  ScriptsDirectory: string,
  ID: unknown,
  RelativeFilePath: unknown
): string | null {
  const Folder = ResolveScriptFolder(ScriptsDirectory, ID);
  if (!Folder || typeof RelativeFilePath !== 'string') return null;
  // Safety is checked on the raw path, then on the normalized one: normalizing
  // turns `..\x` into `../x`, and a leading `\\` into an absolute `//`.
  if (!IsSafeRelativePath(RelativeFilePath)) return null;
  const Normalized = NormalizeScriptRelativePath(RelativeFilePath);
  if (!Normalized) return null;
  return ResolveContainedPath(Folder, Normalized);
}
