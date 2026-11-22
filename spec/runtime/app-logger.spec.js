// src/runtime/app-logger.ts: the console + daily-file logger ShowTrak Server
// and ShowTrak Timers create with their own name and logs folder. The log file
// is what an operator sends back when something went wrong on a show, so these
// check what actually lands in it: the format, the level gating (a shipped
// build must not write debug chatter), ordering across batched async writes,
// and that nothing coloured leaks into the file. Ported from both apps' logger
// tests; the file and tag tests run with each app's name.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { CreateAppLogging } = require('../../dist/runtime/app-logger');

const ENV_KEYS = ['LOG_LEVEL', 'LOG_TO_CONSOLE', 'LOG_TO_FILE', 'NODE_ENV'];
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/;
// Colours as picocolors gives them on a terminal, so the "never in the file"
// checks are meaningful.
const COLORS = Object.fromEntries(
  [
    ['cyan', 36],
    ['magenta', 35],
    ['red', 31],
    ['gray', 90],
    ['green', 32],
  ].map(([Name, Code]) => [Name, (Text) => `\x1b[${Code}m${Text}\x1b[39m`])
);

const APPS = ['ShowTrakServer', 'ShowTrakTimers'];

/**
 * Create a logging for `AppName` in a temp logs folder, with the environment
 * (and optionally process.defaultApp, Electron's "launched from a checkout"
 * flag) set as given while it is created, which is when it reads them.
 */
function Create(t, { AppName = 'ShowTrakTimers', Env = {}, DefaultApp, ...Options } = {}) {
  const Temp = fs.mkdtempSync(path.join(os.tmpdir(), 'st-protocol-logs-'));
  t.after(() => fs.rmSync(Temp, { recursive: true, force: true }));
  const LogsDir = path.join(Temp, 'Logs');

  const Saved = Object.fromEntries(ENV_KEYS.map((Key) => [Key, process.env[Key]]));
  const SavedDefaultApp = process.defaultApp;
  for (const Key of ENV_KEYS) delete process.env[Key];
  Object.assign(process.env, { LOG_TO_CONSOLE: 'false', ...Env });
  if (DefaultApp === undefined) delete process.defaultApp;
  else process.defaultApp = DefaultApp;
  try {
    const Logging = CreateAppLogging({
      AppName,
      LogDirectory: LogsDir,
      Colors: COLORS,
      ...Options,
    });
    return { Logging, LogsDir };
  } finally {
    for (const Key of ENV_KEYS) {
      if (Saved[Key] === undefined) delete process.env[Key];
      else process.env[Key] = Saved[Key];
    }
    if (SavedDefaultApp === undefined) delete process.defaultApp;
    else process.defaultApp = SavedDefaultApp;
  }
}

async function ReadLog(Logging, LogsDir) {
  await Logging.flushLogWrites();
  if (!fs.existsSync(LogsDir)) return [];
  const Files = fs.readdirSync(LogsDir).filter((Name) => Name.endsWith('.log'));
  if (Files.length === 0) return [];
  assert.equal(Files.length, 1, 'one daily file');
  return fs
    .readFileSync(path.join(LogsDir, Files[0]), 'utf8')
    .split('\n')
    .filter((Line) => Line.length > 0);
}

// The message part of each line (after the timestamp and the tags).
const Messages = (Lines) => Lines.map((Line) => Line.replace(/^.*?\] \[.*?\] \[.*?\] /, ''));

test('the logs folder is created with the logging', (t) => {
  const { LogsDir } = Create(t);
  assert.ok(fs.statSync(LogsDir).isDirectory());
});

for (const AppName of APPS) {
  test(`${AppName}: lines go to a daily ${AppName}-YYYY-MM-DD.log in a fixed, plain format`, async (t) => {
    const { Logging, LogsDir } = Create(t, { AppName, Env: { LOG_LEVEL: 'trace' } });
    const Log = Logging.CreateLogger('TestModule');
    Log.info('hello world');
    Log.warn('a warning');
    Log.success('great');
    Log.database('db message');
    Log.debug('debug detail');
    Log.trace('trace detail');
    const Lines = await ReadLog(Logging, LogsDir);
    const [File] = fs.readdirSync(LogsDir);
    assert.match(File, new RegExp(`^${AppName}-\\d{4}-\\d{2}-\\d{2}\\.log$`));
    assert.equal(Lines.length, 6);
    assert.match(
      Lines[0],
      new RegExp(
        `^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2} \\[${AppName}\\] \\[TESTMODULE {7}\\] \\[INFO {13}\\] hello world$`
      )
    );
    assert.match(Lines[1], /\[WARN {13}\] a warning$/);
    assert.match(Lines[2], /\[SUCCESS {10}\] great$/);
    assert.match(Lines[3], /\[DATABASE {9}\] db message$/);
    assert.match(Lines[4], /\[DEBUG {12}\] debug detail$/);
    assert.match(Lines[5], /\[TRACE {12}\] trace detail$/);
    // The file's date is the date in the line.
    assert.equal(File.slice(AppName.length + 1, AppName.length + 11), Lines[0].slice(0, 10));
  });

  test(`${AppName}: the console copy has coloured tags and the raw message; silent() stays off it`, async (t) => {
    const { Logging, LogsDir } = Create(t, { AppName });
    Logging.configure({ toConsole: true });
    const Printed = [];
    t.mock.method(console, 'log', (...Args) => Printed.push(Args));
    const Log = Logging.CreateLogger('Console');
    Log.info('to both');
    Log.debug('gated');
    Log.silent('file only');
    t.mock.restoreAll();
    assert.equal(Printed.length, 1);
    assert.match(Printed[0][0], ANSI, 'the console tags are coloured');
    assert.ok(Printed[0][0].includes(`\x1b[36m${AppName}\x1b[39m`));
    assert.match(Printed[0][0], /CONSOLE/);
    assert.equal(Printed[0][1], 'to both');
    assert.deepEqual(Messages(await ReadLog(Logging, LogsDir)), ['to both', 'file only']);
  });
}

test('every argument is its own line, in order', async (t) => {
  const { Logging, LogsDir } = Create(t);
  Logging.CreateLogger('Multi').log('one', 'two', 'three');
  assert.deepEqual(Messages(await ReadLog(Logging, LogsDir)), ['one', 'two', 'three']);
});

test('errors keep their stack, objects are JSON, and unserialisable values still log', async (t) => {
  const { Logging, LogsDir } = Create(t);
  const Log = Logging.CreateLogger('Ser');
  Log.error(new Error('boom'));
  Log.log({ nested: true, list: [1, 2] });
  const Circular = {};
  Circular.self = Circular;
  Log.log(Circular);
  Log.warn(42, null);
  const Text = (await ReadLog(Logging, LogsDir)).join('\n');
  assert.match(Text, /\[ERROR {12}\] Error: boom/);
  assert.match(Text, /at .*app-logger\.spec\.js/, 'the stack is kept');
  assert.match(Text, /\{"nested":true,"list":\[1,2\]\}/);
  assert.match(Text, /\[object Object\]/);
  assert.match(Text, /\] 42\n.*\] null/);
});

test('nothing coloured reaches the file, even from databaseError', async (t) => {
  const { Logging, LogsDir } = Create(t);
  const Log = Logging.CreateLogger('Colour');
  Log.databaseError('db failed');
  Log.databaseError(new Error('db error object'));
  Log.error({ code: 1 });
  Log.info(COLORS.red('coloured by the caller'));
  const Lines = await ReadLog(Logging, LogsDir);
  for (const Line of Lines) assert.doesNotMatch(Line, ANSI);
  // The error's stack continues over several lines; four entries were logged.
  const Entries = Lines.filter((Line) => /^\d{4}-\d{2}-\d{2} /.test(Line));
  assert.equal(Entries.length, 4);
  assert.match(Entries[0], /\[DATABASE {9}\] db failed$/);
  assert.match(Entries[1], /\[DATABASE {9}\] Error: db error object$/);
  assert.match(Entries[2], /\{"code":1\}$/);
  assert.match(Entries[3], /\] coloured by the caller$/);
});

test('child loggers extend the alias', async (t) => {
  const { Logging, LogsDir } = Create(t);
  const Child = Logging.CreateLogger('Parent').child('Kid');
  assert.equal(Child.Alias, 'Parent:Kid');
  assert.equal(Child.child('Grandkid').Alias, 'Parent:Kid:Grandkid');
  Child.info('from child');
  const [Line] = await ReadLog(Logging, LogsDir);
  assert.match(Line, /\[PARENT:KID {7}\] \[INFO {13}\] from child$/);
});

test('a shipped build (no Electron defaultApp flag, no NODE_ENV) logs at info: no debug or trace', async (t) => {
  const { Logging, LogsDir } = Create(t);
  assert.equal(Logging.DefaultLevel, 'info');
  const Log = Logging.CreateLogger('Level');
  Log.trace('trace line');
  Log.debug('debug line');
  Log.info('info line');
  Log.warn('warn line');
  Log.error('error line');
  assert.deepEqual(Messages(await ReadLog(Logging, LogsDir)), [
    'info line',
    'warn line',
    'error line',
  ]);
});

test('a copy launched from a checkout (process.defaultApp) logs at debug', async (t) => {
  const { Logging, LogsDir } = Create(t, { DefaultApp: true });
  assert.equal(Logging.DefaultLevel, 'debug');
  const Log = Logging.CreateLogger('Dev');
  Log.trace('trace line');
  Log.debug('debug line');
  assert.deepEqual(Messages(await ReadLog(Logging, LogsDir)), ['debug line']);
});

test('NODE_ENV=production means info even when launched from a checkout', async (t) => {
  const { Logging, LogsDir } = Create(t, { DefaultApp: true, Env: { NODE_ENV: 'production' } });
  const Log = Logging.CreateLogger('Prod');
  Log.debug('debug line');
  Log.info('info line');
  assert.deepEqual(Messages(await ReadLog(Logging, LogsDir)), ['info line']);
});

test('LOG_LEVEL overrides the default, in any case', async (t) => {
  const { Logging, LogsDir } = Create(t, { Env: { LOG_LEVEL: 'TRACE' } });
  const Log = Logging.CreateLogger('Env');
  Log.trace('trace line');
  Log.debug('debug line');
  assert.deepEqual(Messages(await ReadLog(Logging, LogsDir)), ['trace line', 'debug line']);

  const Quiet = Create(t, { Env: { LOG_LEVEL: 'error' } });
  const QuietLog = Quiet.Logging.CreateLogger('Env');
  QuietLog.info('info line');
  QuietLog.warn('warn line');
  QuietLog.success('success line');
  QuietLog.database('database line');
  QuietLog.error('error line');
  QuietLog.databaseError('database error line');
  assert.deepEqual(Messages(await ReadLog(Quiet.Logging, Quiet.LogsDir)), [
    'error line',
    'database error line',
  ]);
});

test('an unknown level falls back to the default rather than going silent', async (t) => {
  const { Logging, LogsDir } = Create(t, { Env: { LOG_LEVEL: 'verbose' } });
  const Log = Logging.CreateLogger('Typo');
  Log.debug('debug line');
  Log.info('info line');
  assert.deepEqual(Messages(await ReadLog(Logging, LogsDir)), ['info line']);
});

test('configure() changes the level at runtime; silent() is always written', async (t) => {
  const { Logging, LogsDir } = Create(t);
  const Log = Logging.CreateLogger('Cfg');
  Logging.configure({ level: 'ERROR' });
  Log.info('gated info');
  Log.warn('gated warn');
  Log.error('still logged');
  Log.silent('silent line');
  Logging.configure({ level: 'debug' });
  Log.debug('debug now on');
  Logging.configure();
  Log.debug('configure() with nothing changes nothing');
  assert.deepEqual(Messages(await ReadLog(Logging, LogsDir)), [
    'still logged',
    'silent line',
    'debug now on',
    'configure() with nothing changes nothing',
  ]);
});

test('configure({ toFile: false }) stops file writes until it is turned back on', async (t) => {
  const { Logging, LogsDir } = Create(t);
  const Log = Logging.CreateLogger('File');
  Logging.configure({ toFile: false });
  Log.info('not written');
  Log.silent('not written either');
  assert.deepEqual(await ReadLog(Logging, LogsDir), []);
  Logging.configure({ toFile: true });
  Log.info('written');
  assert.deepEqual(Messages(await ReadLog(Logging, LogsDir)), ['written']);
});

test('LOG_TO_FILE=false turns file logging off from the start', async (t) => {
  const { Logging, LogsDir } = Create(t, { Env: { LOG_TO_FILE: 'FALSE' } });
  Logging.CreateLogger('Env').error('not written');
  assert.deepEqual(await ReadLog(Logging, LogsDir), []);
});

test('a Squirrel install run (SkipFileWrites) writes nothing to the file', async (t) => {
  const { Logging, LogsDir } = Create(t, { SkipFileWrites: true });
  const Log = Logging.CreateLogger('Install');
  Log.error('not written');
  Log.silent('nor this');
  assert.deepEqual(await ReadLog(Logging, LogsDir), []);
});

test('a burst of lines lands in order, in a handful of appends rather than one each', async (t) => {
  const { Logging, LogsDir } = Create(t);
  let Appends = 0;
  const RealAppend = fs.promises.appendFile;
  t.mock.method(fs.promises, 'appendFile', (...Args) => {
    Appends++;
    return RealAppend.apply(fs.promises, Args);
  });
  const Log = Logging.CreateLogger('Burst');
  const Expected = [];
  for (let Index = 0; Index < 500; Index++) {
    Log.info(`line ${Index}`);
    Expected.push(`line ${Index}`);
  }
  assert.deepEqual(Messages(await ReadLog(Logging, LogsDir)), Expected);
  assert.ok(Appends <= 3, `${Appends} appends for 500 lines`);
});

test('lines logged across batches still land in order', async (t) => {
  const { Logging, LogsDir } = Create(t);
  const Log = Logging.CreateLogger('Burst');
  const Expected = [];
  for (let Index = 0; Index < 500; Index++) {
    Log.info(`line ${Index}`);
    Expected.push(`line ${Index}`);
    // Let some batches go out mid-burst.
    if (Index % 97 === 0) await new Promise((resolve) => setImmediate(resolve));
  }
  assert.deepEqual(Messages(await ReadLog(Logging, LogsDir)), Expected);
});

test('the logs folder is recreated if it is removed while the app runs', async (t) => {
  const { Logging, LogsDir } = Create(t);
  const Log = Logging.CreateLogger('Gone');
  Log.info('before');
  await Logging.flushLogWrites();
  fs.rmSync(LogsDir, { recursive: true, force: true });
  Log.info('after');
  assert.deepEqual(Messages(await ReadLog(Logging, LogsDir)), ['after']);
});

test('flushLogWrites resolves when nothing has been logged', async (t) => {
  const { Logging } = Create(t);
  await Logging.flushLogWrites();
});

// --- The live feed (ShowTrak Server's log console) ---------------------------

function RecordingFeed(WantedLevels = []) {
  const Pushed = [];
  return {
    Pushed,
    Feed: {
      Wants: (LevelKey) => WantedLevels.includes(LevelKey),
      Push: (Alias, Type, LevelKey, Message) => Pushed.push({ Alias, Type, LevelKey, Message }),
    },
  };
}

test('the feed receives every emitted line, silent() included, with its type and level', async (t) => {
  const { Feed, Pushed } = RecordingFeed();
  const { Logging, LogsDir } = Create(t, { AppName: 'ShowTrakServer', Feed });
  const Log = Logging.CreateLogger('Feed');
  Log.info('an info line');
  Log.success({ ok: true });
  Log.databaseError('db failed');
  Log.silent('file only');
  Log.debug('below the active level, and not wanted');
  assert.deepEqual(
    Pushed.map(({ Alias, Type, LevelKey }) => [Alias, Type, LevelKey]),
    [
      ['Feed', 'Info', 'info'],
      ['Feed', 'Success', 'info'],
      ['Feed', 'Database', 'error'],
      ['Feed', 'Info', 'info'],
    ]
  );
  assert.equal(Pushed[1].Message, '{"ok":true}');
  // The feed gets the message as serialised, colour and all; it strips it itself.
  assert.match(Pushed[2].Message, ANSI);
  assert.equal((await ReadLog(Logging, LogsDir)).length, 4);
});

test('a line below the active level reaches a feed that wants it, and nothing else', async (t) => {
  const { Feed, Pushed } = RecordingFeed(['debug', 'trace']);
  const { Logging, LogsDir } = Create(t, { AppName: 'ShowTrakServer', Feed });
  Logging.configure({ toConsole: true });
  const Printed = [];
  t.mock.method(console, 'log', (...Args) => Printed.push(Args));
  const Log = Logging.CreateLogger('Watch');
  Log.trace('for the console only');
  Log.debug('this too');
  t.mock.restoreAll();
  assert.deepEqual(
    Pushed.map((P) => P.Message),
    ['for the console only', 'this too']
  );
  assert.deepEqual(Printed, [], 'not on the console');
  assert.deepEqual(await ReadLog(Logging, LogsDir), [], 'not in the file');
});

test('without a feed, a gated line is never serialised', (t) => {
  const { Logging } = Create(t);
  const Log = Logging.CreateLogger('Cheap');
  const Costly = {
    toJSON() {
      throw new Error('serialised a line nobody will see');
    },
  };
  assert.doesNotThrow(() => Log.debug(Costly));
});
