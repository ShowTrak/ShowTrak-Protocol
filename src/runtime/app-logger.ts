// The console + daily-file logger ShowTrak Server and ShowTrak Timers share.
//
// Leveled logging with coloured console tags, and a plain copy of every line
// appended to `<LogDirectory>/<AppName>-YYYY-MM-DD.log`: asynchronous, ordered,
// batched writes (lines logged while a write is in flight go out together in
// one append), filed under the day each line was logged. The primitives it is
// built from (level ranking, the default level, formatting) are in ./logging.
//
// The two apps carried this as two copies of one file, Timers' "a port of
// ShowTrak Server's logger", and fixes to the write queue had to be made twice.
// What differs between them is passed in: the app's name, its logs folder,
// the colours, whether this is a Squirrel install run, and, for the Server
// only, the live feed its log console reads (`Feed`).
//
// ShowTrak Client does NOT use this, deliberately: an unattended agent that
// crashes must not lose the lines that explain why, so its sink writes
// synchronously. That is a durability-versus-throughput decision per app.
import fs from 'fs';
import path from 'path';

import {
  GetDatestampLabel,
  GetDateTimeStamp,
  IsLevelEnabled,
  Pad,
  ResolveDefaultLevel,
  SerializeArg,
  StripAnsi,
  type LoggerConfigureOptions,
} from './logging';

/** The colours the console tags use: picocolors' functions, passed in by the app. */
export interface LogColors {
  cyan(text: string): string;
  magenta(text: string): string;
  red(text: string): string;
  gray(text: string): string;
  green(text: string): string;
}

/**
 * A live feed of the lines the logger produces (ShowTrak Server's log console).
 * Optional: without one, nothing below the active level is ever serialised.
 */
export interface LogFeed {
  /**
   * Whether the feed wants lines at this level although the active level drops
   * them (a console watching at 'trace'). Such lines are produced for the feed
   * only, never written to the console or the file.
   */
  Wants(LevelKey: string): boolean;
  /**
   * One line, as serialised for the file but before ANSI codes are stripped.
   * Called for every line emitted at or above the active level, and for those
   * below it that `Wants` asked for. A throw here is the feed's own problem:
   * the feed must catch it.
   */
  Push(Alias: string, Type: string, LevelKey: string, Message: string): void;
}

export interface AppLoggingOptions {
  /** The app's name, as every line is tagged and the daily file is named ('ShowTrakServer'). */
  AppName: string;
  /** The folder the daily files go in. Created when the logging is, if missing. */
  LogDirectory: string;
  /** Colours for the console copy (the app's picocolors). The file copy is never coloured. */
  Colors: LogColors;
  /**
   * True for a Squirrel.Windows install or update run (electron-squirrel-startup),
   * which should leave no log file behind: lines go to the console only.
   */
  SkipFileWrites?: boolean;
  /** ShowTrak Server's log console. */
  Feed?: LogFeed;
}

/** The writer one AppLogger instance delegates to. */
interface LineWriter {
  Write(Alias: string, Type: string, Arg: unknown, LevelKey: string): void;
  Silent(Alias: string, Arg: unknown): void;
  Red(Text: string): string;
}

/** A named logger: every line it writes is tagged with its Alias. */
export class AppLogger {
  Alias: string;
  private readonly Writer: LineWriter;

  constructor(Alias: string, Writer: LineWriter) {
    this.Alias = Alias;
    this.Writer = Writer;
  }
  log(...args: unknown[]): void {
    args.forEach((arg) => this.Writer.Write(this.Alias, 'Info', arg, 'info'));
  }
  // Alias of log(); both names are used across the apps.
  info(...args: unknown[]): void {
    this.log(...args);
  }
  /** Always written to the file (whatever the level), never to the console. */
  silent(...args: unknown[]): void {
    args.forEach((arg) => this.Writer.Silent(this.Alias, arg));
  }
  warn(...args: unknown[]): void {
    args.forEach((arg) => this.Writer.Write(this.Alias, 'Warn', arg, 'warn'));
  }
  error(...args: unknown[]): void {
    args.forEach((arg) =>
      this.Writer.Write(
        this.Alias,
        'Error',
        arg instanceof Error ? arg : SerializeArg(arg),
        'error'
      )
    );
  }
  debug(...args: unknown[]): void {
    args.forEach((arg) => this.Writer.Write(this.Alias, 'Debug', arg, 'debug'));
  }
  trace(...args: unknown[]): void {
    args.forEach((arg) => this.Writer.Write(this.Alias, 'Trace', arg, 'trace'));
  }
  success(...args: unknown[]): void {
    args.forEach((arg) => this.Writer.Write(this.Alias, 'Success', arg, 'info'));
  }
  database(...args: unknown[]): void {
    args.forEach((arg) => this.Writer.Write(this.Alias, 'Database', arg, 'info'));
  }
  databaseError(...args: unknown[]): void {
    args.forEach((arg) =>
      this.Writer.Write(
        this.Alias,
        'Database',
        arg instanceof Error ? arg : this.Writer.Red(String(arg)),
        'error'
      )
    );
  }
  /** A logger for part of this one: its alias is `<Alias>:<suffix>`. */
  child(suffix: string): AppLogger {
    return new AppLogger(`${this.Alias}:${suffix}`, this.Writer);
  }
}

export interface AppLogging {
  CreateLogger(Alias: string): AppLogger;
  /** Change the level, or turn the console or file copy off or on, at runtime. */
  configure(options?: LoggerConfigureOptions): void;
  /**
   * Resolves once every line logged so far has been handed to the OS. For tests
   * and orderly shutdown; logging itself never waits on it.
   */
  flushLogWrites(): Promise<void>;
  /** The level used when LOG_LEVEL is not set (ResolveDefaultLevel), and the fallback for an unknown one. */
  DefaultLevel: string;
}

/**
 * Create an app's logging. Called once, when the app's Logger module loads:
 * this is when LOG_LEVEL, LOG_TO_CONSOLE and LOG_TO_FILE are read and the logs
 * folder is created.
 *
 * LOG_LEVEL overrides the default level (a copy misbehaving on site can be
 * relaunched with LOG_LEVEL=debug, no rebuild); LOG_TO_CONSOLE=false and
 * LOG_TO_FILE=false turn either copy off.
 */
export function CreateAppLogging(Options: AppLoggingOptions): AppLogging {
  const { AppName, LogDirectory, Colors, SkipFileWrites = false, Feed } = Options;
  const fsp = fs.promises;

  if (!fs.existsSync(LogDirectory)) {
    fs.mkdirSync(LogDirectory, { recursive: true });
  }

  const Types: Record<string, string> = {
    Info: Colors.cyan(Pad('INFO')),
    Warn: Colors.magenta(Pad('WARN')),
    Error: Colors.red(Pad('ERROR')),
    Trace: Colors.magenta(Pad('TRACE')),
    Debug: Colors.gray(Pad('DEBUG')),
    Success: Colors.green(Pad('SUCCESS')),
    Database: Colors.gray(Pad('DATABASE')),
  };

  // Plain (non-coloured) labels for the file.
  const PlainTypes: Record<string, string> = {
    Info: Pad('INFO'),
    Warn: Pad('WARN'),
    Error: Pad('ERROR'),
    Trace: Pad('TRACE'),
    Debug: Pad('DEBUG'),
    Success: Pad('SUCCESS'),
    Database: Pad('DATABASE'),
  };

  // A packaged Electron app has no NODE_ENV, so that test alone would leave
  // every shipped copy logging at 'debug'. Electron sets `process.defaultApp`
  // only when the app was launched from a checkout (`electron .`), so its
  // absence is the "shipped build" signal, the test `app.isPackaged` performs.
  // It is read off process rather than from `app` so that the Logger, the
  // lowest module in each app, stays loadable outside Electron (the test
  // suites load it directly).
  const DefaultLevel = ResolveDefaultLevel({
    nodeEnv: process.env.NODE_ENV,
    isPackagedBuild: !(process as { defaultApp?: boolean }).defaultApp,
  });
  const Settings = {
    level: (process.env.LOG_LEVEL || DefaultLevel).toLowerCase(),
    toConsole: (process.env.LOG_TO_CONSOLE || 'true').toLowerCase() !== 'false',
    toFile: (process.env.LOG_TO_FILE || 'true').toLowerCase() !== 'false',
  };

  const Has = (Table: Record<string, string>, Type: string) =>
    Object.prototype.hasOwnProperty.call(Table, Type);

  function Tag(Text: string, Type: string): string {
    return `[${Colors.cyan(AppName)}] [${Colors.cyan(Pad(Text))}] [${
      Has(Types, Type) ? Types[Type] : Types['Info']
    }]`;
  }

  function TagPlain(Text: string, Type: string): string {
    return `[${AppName}] [${Pad(Text)}] [${
      Has(PlainTypes, Type) ? PlainTypes[Type] : PlainTypes['Info']
    }]`;
  }

  // Daily rollover: each line is filed under the day it was logged.
  function TodayLogFilePath(): string {
    return path.join(LogDirectory, `${AppName}-${GetDatestampLabel()}.log`);
  }

  // Append one batch to its file. appendFile creates the file; the folder is
  // only recreated if something removed it while the app was running.
  async function AppendBatch(FilePath: string, Text: string): Promise<void> {
    try {
      await fsp.appendFile(FilePath, Text, 'utf8');
    } catch (Err) {
      if ((Err as NodeJS.ErrnoException | null)?.code !== 'ENOENT') throw Err;
      await fsp.mkdir(LogDirectory, { recursive: true });
      await fsp.appendFile(FilePath, Text, 'utf8');
    }
  }

  // Ordered, asynchronous file writes, batched: lines logged while a write is
  // in flight go out together in one append once it lands, rather than an
  // open/append/close per line, which during a burst (a reconnect storm, a
  // deployment to every client) was most of the logger's cost, and on Windows
  // each open is also scanned by antivirus.
  let WriteTail: Promise<unknown> = Promise.resolve();
  let PendingLines: Array<{ FilePath: string; Line: string }> = [];
  function EnqueueWrite(Line: string): void {
    if (SkipFileWrites || !Settings.toFile) return;
    PendingLines.push({ FilePath: TodayLogFilePath(), Line });
    if (PendingLines.length > 1) return; // a flush is already queued for this batch
    WriteTail = WriteTail.then(async () => {
      const Batch = PendingLines;
      PendingLines = [];
      // Consecutive lines for the same day's file become one append; a batch
      // spanning midnight splits at the rollover, keeping order.
      let I = 0;
      while (I < Batch.length) {
        const FilePath = Batch[I]!.FilePath;
        let Text = '';
        while (I < Batch.length && Batch[I]!.FilePath === FilePath) {
          Text += Batch[I]!.Line + '\n';
          I++;
        }
        try {
          await AppendBatch(FilePath, Text);
        } catch {
          /* file logging is best-effort; the console still has the line */
        }
      }
    }).catch(() => null);
  }

  function flushLogWrites(): Promise<void> {
    return WriteTail.then(() => (PendingLines.length ? flushLogWrites() : undefined));
  }

  // The level gates emission uniformly: a message below the active level is
  // written neither to the console nor to the file. (`silent()` bypasses this
  // on purpose; it is always written to the file.) A feed that asked for it
  // still receives it.
  const Writer: LineWriter = {
    Write(Alias, Type, Arg, LevelKey) {
      const Enabled = IsLevelEnabled(LevelKey, Settings.level, DefaultLevel);
      if (!Enabled && !(Feed && Feed.Wants(LevelKey))) return;
      const Message = SerializeArg(Arg);
      if (Feed) Feed.Push(Alias, Type, LevelKey, Message);
      if (!Enabled) return;
      const Line = `${GetDateTimeStamp()} ${TagPlain(Alias, Type)} ${StripAnsi(Message)}`;
      if (Settings.toConsole) console.log(Tag(Alias, Type), Message);
      EnqueueWrite(Line);
    },
    Silent(Alias, Arg) {
      const Message = SerializeArg(Arg);
      if (Feed) Feed.Push(Alias, 'Info', 'info', Message);
      EnqueueWrite(`${GetDateTimeStamp()} ${TagPlain(Alias, 'Info')} ${Message}`);
    },
    Red: (Text) => Colors.red(Text),
  };

  return {
    CreateLogger: (Alias: string) => new AppLogger(Alias, Writer),
    configure(options: LoggerConfigureOptions = {}) {
      if (options.level) Settings.level = String(options.level).toLowerCase();
      if (typeof options.toConsole === 'boolean') Settings.toConsole = options.toConsole;
      if (typeof options.toFile === 'boolean') Settings.toFile = options.toFile;
    },
    flushLogWrites,
    DefaultLevel,
  };
}
