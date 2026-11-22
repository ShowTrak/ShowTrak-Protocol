// src/electron/file-associations.ts: show files opened from the operating
// system, created with each app's extension and Windows names. What is at
// stake: a double-click in Finder or Explorer swaps out the running show, so
// it must find the right file, and only ever open the one the operator was
// asked about. Ported from ShowTrak Server's and ShowTrak Timers'
// file-associations tests; every test runs for both apps.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  CreateShowFileAssociations,
  SquirrelStubExecutable,
} = require('../../dist/electron/file-associations');

const APPS = [
  {
    App: 'Server',
    Options: {
      Extension: 'showtrak',
      WindowsProgId: 'ShowTrak.ShowFile',
      WindowsTypeName: 'ShowTrak Show File',
    },
    FileName: 'Main Stage.ShowTrak',
    InstallDir: 'showtrak_server',
    Exe: 'showtrak-server.exe',
  },
  {
    App: 'Timers',
    Options: {
      Extension: 'showtraktimers',
      WindowsProgId: 'ShowTrak.TimersShowFile',
      WindowsTypeName: 'ShowTrak Timers Show File',
    },
    FileName: 'Main Stage.ShowTrakTimers',
    InstallDir: 'showtrak_timers',
    Exe: 'ShowTrak Timers.exe',
  },
];

function tempDir(t) {
  const Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-assoc-'));
  t.after(() => fs.rmSync(Dir, { recursive: true, force: true }));
  return Dir;
}

test('the stub executable is the one Squirrel keeps above the versioned folder', () => {
  assert.equal(
    SquirrelStubExecutable(path.join('/root', 'app-1.2.3', 'App.exe')),
    path.resolve('/root', 'App.exe')
  );
});

test('each app holds its own requests', () => {
  const Server = CreateShowFileAssociations(APPS[0].Options);
  const Timers = CreateShowFileAssociations(APPS[1].Options);
  Server.RequestShowFileOpen('/a.showtrak');
  assert.equal(Timers.TakeShowFileRequest(), null);
  assert.equal(Server.TakeShowFileRequest().FilePath, '/a.showtrak');
});

for (const { App, Options, FileName, InstallDir, Exe } of APPS) {
  const { Extension, WindowsProgId, WindowsTypeName } = Options;
  const FA = CreateShowFileAssociations(Options);
  const At = (Name) => `/${Name}.${Extension}`;
  const Fresh = () => FA.ResetShowFileRequestsForTests();

  test(`${App}: names the extension and ProgID it was created with`, () => {
    assert.equal(FA.SHOW_FILE_EXTENSION, Extension);
    assert.equal(FA.WINDOWS_PROG_ID, WindowsProgId);
  });

  // --- Command line ------------------------------------------------------------

  test(`${App}: finds an existing .${Extension} on the command line, in any letter case`, (t) => {
    const Dir = tempDir(t);
    const File = path.join(Dir, FileName);
    fs.writeFileSync(File, '');
    assert.equal(FA.ShowFileFromArgv(['--squirrel-firstrun', File]), File);
    assert.equal(FA.ShowFileFromArgv([FileName], Dir), File, 'relative to the cwd given');
    // The last one wins.
    const Other = path.join(Dir, `Other.${Extension}`);
    fs.writeFileSync(Other, '');
    assert.equal(FA.ShowFileFromArgv([File, Other]), Other);
  });

  test(`${App}: ignores switches, other files, folders and show files that do not exist`, (t) => {
    const Dir = tempDir(t);
    fs.writeFileSync(path.join(Dir, 'notes.txt'), '');
    fs.mkdirSync(path.join(Dir, `folder.${Extension}`));
    assert.equal(
      FA.ShowFileFromArgv(
        [
          '.',
          '--allow-file-access-from-files',
          'notes.txt',
          `gone.${Extension}`,
          `folder.${Extension}`,
        ],
        Dir
      ),
      null
    );
    assert.equal(FA.IsShowFilePath(`--x.${Extension}`), false);
    assert.equal(FA.IsShowFilePath(42), false);
    assert.equal(FA.IsShowFilePath(`show.${Extension.toUpperCase()}`), true);
  });

  // --- Requests ----------------------------------------------------------------

  test(`${App}: a request before the renderer starts is part of the launch, and is not announced`, () => {
    Fresh();
    let Announced = 0;
    FA.OnShowFileRequest(() => Announced++);
    FA.RequestShowFileOpen(At('a'));
    assert.equal(Announced, 0);
    assert.deepEqual(FA.TakeShowFileRequest(), { FilePath: At('a'), Source: 'Launch' });
    assert.equal(FA.TakeShowFileRequest(), null, 'taken once');
  });

  test(`${App}: once the renderer has started, a request is announced and asks first`, () => {
    Fresh();
    let Announced = 0;
    FA.OnShowFileRequest(() => Announced++);
    FA.TakeShowFileRequest();
    FA.RequestShowFileOpen(At('a'));
    FA.RequestShowFileOpen(At('b'));
    assert.equal(Announced, 2);
    assert.deepEqual(FA.TakeShowFileRequest(), { FilePath: At('b'), Source: 'Running' });
  });

  test(`${App}: a listener that throws does not lose the request`, () => {
    Fresh();
    FA.OnShowFileRequest(() => {
      throw new Error('window gone');
    });
    FA.TakeShowFileRequest();
    assert.doesNotThrow(() => FA.RequestShowFileOpen(At('a')));
    assert.equal(FA.TakeShowFileRequest().FilePath, At('a'));
  });

  test(`${App}: the taken request is the only one that can be opened, once`, () => {
    Fresh();
    FA.RequestShowFileOpen(At('a'));
    FA.TakeShowFileRequest();
    FA.RequestShowFileOpen(At('b')); // arrives while the operator is asked about a
    assert.deepEqual(FA.ConsumeTakenShowFileRequest(), { FilePath: At('a'), Source: 'Launch' });
    assert.equal(FA.ConsumeTakenShowFileRequest(), null);
    assert.equal(FA.TakeShowFileRequest().FilePath, At('b'), 'b waits its turn');
  });

  // --- Windows registry --------------------------------------------------------

  test(`${App}: Squirrel install and update register .${Extension} against the stub exe`, () => {
    const ExecPath = `C:/Users/op/AppData/Local/${InstallDir}/app-9.8.7/${Exe}`;
    for (const Event of ['--squirrel-install', '--squirrel-updated']) {
      const Calls = [];
      const Action = FA.HandleSquirrelFileAssociations(['exe', Event, '9.8.7'], {
        Platform: 'win32',
        ExecPath,
        Run: (Args) => (Calls.push(Args), { status: 0 }),
      });
      assert.equal(Action, 'register');
      const Stub = SquirrelStubExecutable(ExecPath);
      assert.doesNotMatch(Stub, /app-9\.8\.7/, 'not the versioned folder Squirrel deletes');
      const ExtensionKey = `HKCU\\Software\\Classes\\.${Extension}`;
      const ProgIdKey = `HKCU\\Software\\Classes\\${WindowsProgId}`;
      assert.deepEqual(Calls, [
        ['add', ExtensionKey, '/ve', '/d', WindowsProgId, '/f'],
        ['add', `${ExtensionKey}\\OpenWithProgids`, '/v', WindowsProgId, '/t', 'REG_NONE', '/f'],
        ['add', ProgIdKey, '/ve', '/d', WindowsTypeName, '/f'],
        ['add', `${ProgIdKey}\\DefaultIcon`, '/ve', '/d', `"${Stub}",0`, '/f'],
        ['add', `${ProgIdKey}\\shell\\open\\command`, '/ve', '/d', `"${Stub}" "%1"`, '/f'],
      ]);
    }
  });

  test(`${App}: Squirrel uninstall removes the association, and .${Extension} only while it is still ours`, () => {
    const Run = (Default) => {
      const Calls = [];
      FA.HandleSquirrelFileAssociations(['exe', '--squirrel-uninstall'], {
        Platform: 'win32',
        ExecPath: `/root/app-1.0.0/${Exe}`,
        Run: (Args) => {
          Calls.push(Args);
          return Args[0] === 'query'
            ? { status: 0, stdout: `(Default) REG_SZ ${Default}` }
            : { status: 0 };
        },
      });
      return Calls;
    };
    const DeletesExtension = (Calls) =>
      Calls.some(
        (A) =>
          A[0] === 'delete' &&
          A[1] === `HKCU\\Software\\Classes\\.${Extension}` &&
          A.includes('/ve')
      );
    assert.ok(
      Run(WindowsProgId).some((A) => A[0] === 'delete' && A[1].endsWith(`\\${WindowsProgId}`))
    );
    assert.equal(DeletesExtension(Run(WindowsProgId)), true);
    assert.equal(DeletesExtension(Run('SomeOtherApp.File')), false);
  });

  test(`${App}: nothing happens outside Windows or without a Squirrel event`, () => {
    const Run = () => assert.fail('must not touch the registry');
    assert.equal(
      FA.HandleSquirrelFileAssociations(['exe', '--squirrel-install'], { Platform: 'darwin', Run }),
      null
    );
    for (const Argv of [['exe', `show.${Extension}`], ['exe', '--squirrel-firstrun'], ['exe']]) {
      assert.equal(FA.HandleSquirrelFileAssociations(Argv, { Platform: 'win32', Run }), null);
    }
  });

  test(`${App}: a failing reg.exe never fails the install`, () => {
    const Action = FA.HandleSquirrelFileAssociations(['exe', '--squirrel-install'], {
      Platform: 'win32',
      ExecPath: `/root/app-1.0.0/${Exe}`,
      Run: () => {
        throw new Error('reg.exe missing');
      },
    });
    assert.equal(Action, 'register');
  });
}
