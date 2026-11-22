// Show file associations (main process): opening an app's show file from the
// operating system, by double-clicking it or with "Open With". ShowTrak Server
// (.ShowTrak) and ShowTrak Timers (.showtraktimers) laid this out identically;
// the extension and the Windows names are what differ, and are passed in.
//
// How a file reaches the app depends on the platform:
// - macOS: Launch Services sends an 'open-file' event, both when the file
//   launches the app (the event fires before 'ready') and when the app is
//   already running. The document type itself is declared in Info.plist
//   (CFBundleDocumentTypes in the app's forge.config.ts).
// - Windows: the path is a command-line argument, of this process when the file
//   launched the app, or of a second instance (which hands its arguments over
//   through 'second-instance' and exits) when it was already running. Squirrel
//   has no notion of file associations, so the registry keys are written by the
//   install/update hooks below and removed again on uninstall.
//
// Requests are held here rather than acted on. The renderer takes the latest
// (TakeShowFileRequest) once it is ready for it, asks the operator what it
// needs to (unsaved changes, replacing the running show), and only then has it
// opened, through the same prompts as File > Open. The request it took is the
// only one that can then be opened (ConsumeTakenShowFileRequest), so the
// renderer never names a file itself.
//
// The app's module loads this before anything else in its main process (the
// Squirrel hooks run before the app quits on an install event), so it imports
// nothing but Node built-ins.
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { ShowFileRequest } from '@showtrak/protocol';

export interface ShowFileAssociationOptions {
  /** The show file extension, without the dot: 'showtrak', 'showtraktimers'. Matched in any case. */
  Extension: string;
  /** The Windows ProgID the extension is registered to: 'ShowTrak.ShowFile'. */
  WindowsProgId: string;
  /** What Explorer calls the file type: 'ShowTrak Show File'. */
  WindowsTypeName: string;
}

/** Runs reg.exe: what it answered is its exit status, and its output for a query. */
export type RegRunner = (Args: string[]) => { status: number | null; stdout?: unknown };

export interface SquirrelAssociationOptions {
  /** Defaults to process.platform: nothing happens outside 'win32'. */
  Platform?: string;
  /** Defaults to process.execPath. */
  ExecPath?: string;
  /** Runs reg.exe; defaults to spawning it. For tests. */
  Run?: RegRunner;
}

export interface ShowFileAssociations {
  /** The extension, as passed in. */
  readonly SHOW_FILE_EXTENSION: string;
  readonly WINDOWS_PROG_ID: string;
  /** Whether a value is a path ending in the show file extension (switches excluded). */
  IsShowFilePath(Value: unknown): Value is string;
  /**
   * The show file named on a command line, if any: the last argument that is an
   * existing show file. Relative paths resolve against WorkingDirectory (a second
   * instance's, which can differ from ours). Switches, Squirrel's included, and
   * anything else are ignored.
   */
  ShowFileFromArgv(Argv: readonly unknown[], WorkingDirectory?: string): string | null;
  /**
   * Hold FilePath for the renderer and tell it there is one waiting. Before the
   * renderer has started this is a no-op beyond the hold: it takes the request
   * itself during start-up. Only the latest request counts: one show is open at a
   * time.
   */
  RequestShowFileOpen(FilePath: string): void;
  /**
   * Take the held request for the renderer to ask the operator about. A request
   * held when the renderer first takes one is part of the launch (Source
   * 'Launch'); any later one 'Running'.
   */
  TakeShowFileRequest(): ShowFileRequest | null;
  /** The operator agreed: the request last taken, once. */
  ConsumeTakenShowFileRequest(): ShowFileRequest | null;
  /** Called whenever a request arrives once the renderer is running. */
  OnShowFileRequest(Listener: () => void): void;
  /** Test hook: back to a fresh launch. */
  ResetShowFileRequestsForTests(): void;
  /** The reg.exe invocations that register (or remove) the association, per-user (HKCU). */
  WindowsAssociationCommands(Action: 'register' | 'unregister', StubPath: string): string[][];
  /**
   * Run from the app's entry before electron-squirrel-startup handles (and quits
   * on) the same events. Synchronous, as Squirrel waits on the hook process and
   * the app quits straight after. Returns the action taken, for logging and tests.
   * Never throws: a failed association must never fail the install itself.
   */
  HandleSquirrelFileAssociations(
    Argv?: readonly string[],
    Options?: SquirrelAssociationOptions
  ): 'register' | 'unregister' | null;
}

const CLASSES_KEY = 'HKCU\\Software\\Classes';

/**
 * Squirrel installs each version into <root>\app-<version>\ and keeps a stub
 * executable of the same name in <root> that starts the newest one, passing its
 * arguments through. An association points at the stub, so it survives updates
 * (which delete the old app-<version> folder).
 */
export function SquirrelStubExecutable(ExecPath: string): string {
  return path.resolve(path.dirname(ExecPath), '..', path.basename(ExecPath));
}

const RunReg: RegRunner = (Args) =>
  spawnSync('reg.exe', Args, { windowsHide: true, stdio: 'ignore', timeout: 5000 });

const QueryReg: RegRunner = (Args) =>
  spawnSync('reg.exe', Args, { windowsHide: true, encoding: 'utf8', timeout: 5000 });

/** Create an app's show file associations. Call once, when the app's module loads. */
export function CreateShowFileAssociations(
  Options: ShowFileAssociationOptions
): ShowFileAssociations {
  const { Extension, WindowsProgId, WindowsTypeName } = Options;
  const ExtensionKey = `${CLASSES_KEY}\\.${Extension}`;

  // Only the latest request counts: one show is open at a time, so opening
  // several files at once ends up on the last one anyway.
  let Pending: ShowFileRequest | null = null;
  // The request the renderer took and is asking the operator about.
  let Taken: ShowFileRequest | null = null;
  // Set once the renderer first takes a request. Until then any request is part
  // of the launch.
  let RendererStarted = false;
  let OnRequestListener: (() => void) | null = null;

  function IsShowFilePath(Value: unknown): Value is string {
    return (
      typeof Value === 'string' &&
      !Value.startsWith('-') &&
      path.extname(Value).toLowerCase() === `.${Extension.toLowerCase()}`
    );
  }

  function WindowsAssociationCommands(
    Action: 'register' | 'unregister',
    StubPath: string
  ): string[][] {
    const ProgIdKey = `${CLASSES_KEY}\\${WindowsProgId}`;
    if (Action === 'unregister') {
      return [
        ['delete', ProgIdKey, '/f'],
        ['delete', `${ExtensionKey}\\OpenWithProgids`, '/v', WindowsProgId, '/f'],
      ];
    }
    return [
      ['add', ExtensionKey, '/ve', '/d', WindowsProgId, '/f'],
      ['add', `${ExtensionKey}\\OpenWithProgids`, '/v', WindowsProgId, '/t', 'REG_NONE', '/f'],
      ['add', ProgIdKey, '/ve', '/d', WindowsTypeName, '/f'],
      ['add', `${ProgIdKey}\\DefaultIcon`, '/ve', '/d', `"${StubPath}",0`, '/f'],
      ['add', `${ProgIdKey}\\shell\\open\\command`, '/ve', '/d', `"${StubPath}" "%1"`, '/f'],
    ];
  }

  // Whether the extension's default handler is still ours. Uninstalling leaves
  // the extension alone when something else has since claimed it.
  function ExtensionPointsAtUs(Run: RegRunner): boolean {
    const Result = Run(['query', ExtensionKey, '/ve']);
    return Result.status === 0 && String(Result.stdout || '').includes(WindowsProgId);
  }

  return {
    SHOW_FILE_EXTENSION: Extension,
    WINDOWS_PROG_ID: WindowsProgId,
    IsShowFilePath,
    ShowFileFromArgv(Argv, WorkingDirectory = process.cwd()) {
      let Found: string | null = null;
      for (const Arg of Argv) {
        if (!IsShowFilePath(Arg)) continue;
        const Resolved = path.resolve(WorkingDirectory, Arg);
        try {
          if (fs.statSync(Resolved).isFile()) Found = Resolved;
        } catch {
          /* intentional: a path that does not exist is not a file to open */
        }
      }
      return Found;
    },
    RequestShowFileOpen(FilePath) {
      Pending = { FilePath, Source: RendererStarted ? 'Running' : 'Launch' };
      if (RendererStarted && OnRequestListener) {
        try {
          OnRequestListener();
        } catch {
          /* intentional: notifying is best-effort, the request stays held */
        }
      }
    },
    TakeShowFileRequest() {
      RendererStarted = true;
      Taken = Pending;
      Pending = null;
      return Taken;
    },
    ConsumeTakenShowFileRequest() {
      const Request = Taken;
      Taken = null;
      return Request;
    },
    OnShowFileRequest(Listener) {
      OnRequestListener = Listener;
    },
    ResetShowFileRequestsForTests() {
      Pending = null;
      Taken = null;
      RendererStarted = false;
      OnRequestListener = null;
    },
    WindowsAssociationCommands,
    HandleSquirrelFileAssociations(Argv = process.argv, SquirrelOptions = {}) {
      if ((SquirrelOptions.Platform ?? process.platform) !== 'win32') return null;
      const Event = Argv[1];
      const Action =
        Event === '--squirrel-install' || Event === '--squirrel-updated'
          ? 'register'
          : Event === '--squirrel-uninstall'
            ? 'unregister'
            : null;
      if (!Action) return null;
      const Run = SquirrelOptions.Run ?? RunReg;
      const Stub = SquirrelStubExecutable(SquirrelOptions.ExecPath ?? process.execPath);
      try {
        for (const Args of WindowsAssociationCommands(Action, Stub)) Run(Args);
        if (Action === 'unregister' && ExtensionPointsAtUs(SquirrelOptions.Run ?? QueryReg)) {
          Run(['delete', ExtensionKey, '/ve', '/f']);
        }
      } catch {
        /* intentional: a failed association must never fail the install itself */
      }
      return Action;
    },
  };
}
