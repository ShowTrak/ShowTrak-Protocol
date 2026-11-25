// src/runtime/script-launch.ts: how ShowTrak Server and ShowTrak Client start a
// script file, and the check that keeps a script's paths inside its folder.
// One copy for both, so a script that runs on a client runs the same way when
// the operator runs it on the server machine.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  ResolveScriptLauncher,
  NormalizeScriptRelativePath,
  IsSafeRelativePath,
  ResolveContainedPath,
  IsSafeScriptID,
  ResolveScriptFolder,
  ResolveScriptFile,
} = require('../../dist/runtime/script-launch');

const Head = (Text) => () => (Text === null ? null : Buffer.from(Text, 'latin1'));

function tempDir(t) {
  const Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'st-protocol-scripts-'));
  t.after(() => fs.rmSync(Dir, { recursive: true, force: true }));
  return Dir;
}

test('Windows: batch through cmd, PowerShell with the policy bypassed, an exe directly', () => {
  const Resolve = (File) => ResolveScriptLauncher(File, 'win32');
  assert.deepEqual(Resolve('C:\\s\\run.bat'), {
    command: 'cmd.exe',
    args: ['/c', 'C:\\s\\run.bat'],
  });
  assert.deepEqual(Resolve('C:\\s\\run.CMD'), {
    command: 'cmd.exe',
    args: ['/c', 'C:\\s\\run.CMD'],
  });
  assert.deepEqual(Resolve('C:\\s\\run.ps1'), {
    command: 'powershell.exe',
    args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'C:\\s\\run.ps1'],
  });
  assert.deepEqual(Resolve('C:\\s\\tool.exe'), { command: 'C:\\s\\tool.exe', args: [] });
  // Anything else goes through cmd, so the file associations apply.
  assert.deepEqual(Resolve('C:\\s\\thing.vbs'), {
    command: 'cmd.exe',
    args: ['/c', 'C:\\s\\thing.vbs'],
  });
  assert.deepEqual(Resolve('C:\\s\\run'), { command: 'cmd.exe', args: ['/c', 'C:\\s\\run'] });
});

test('macOS and Linux: each script type goes to its own interpreter', () => {
  for (const Platform of ['darwin', 'linux']) {
    const Resolve = (File) => ResolveScriptLauncher(File, Platform);
    assert.deepEqual(Resolve('/s/run.sh'), { command: '/bin/sh', args: ['/s/run.sh'] });
    assert.deepEqual(Resolve('/s/RUN.SH'), { command: '/bin/sh', args: ['/s/RUN.SH'] });
    assert.deepEqual(Resolve('/s/run.command'), { command: '/bin/sh', args: ['/s/run.command'] });
    assert.deepEqual(Resolve('/s/run.bash'), { command: '/bin/bash', args: ['/s/run.bash'] });
    // Not bash: zsh syntax (arrays from 1, glob qualifiers) breaks under bash.
    assert.deepEqual(Resolve('/s/run.zsh'), { command: 'zsh', args: ['/s/run.zsh'] });
    assert.deepEqual(Resolve('/s/run.py'), { command: 'python3', args: ['/s/run.py'] });
    assert.deepEqual(Resolve('/s/run.js'), { command: 'node', args: ['/s/run.js'] });
    assert.deepEqual(Resolve('/s/run.pl'), { command: '/s/run.pl', args: [] });
  }
});

test('an extensionless file runs directly when it has a shebang or is a binary, else under sh', () => {
  const Resolve = (Text) => ResolveScriptLauncher('/s/run', 'darwin', Head(Text));
  const Direct = { command: '/s/run', args: [] };
  const Shell = { command: '/bin/sh', args: ['/s/run'] };

  assert.deepEqual(Resolve('#!/usr/bin/env python3\nprint(1)\n'), Direct);
  assert.deepEqual(Resolve('\xcf\xfa\xed\xfe\x0c\x00\x00\x01'), Direct); // Mach-O
  assert.deepEqual(Resolve('\x7fELF\x02\x01\x01\x00'), Direct);
  assert.deepEqual(Resolve('echo "no shebang"\n'), Shell);
  assert.deepEqual(Resolve(''), Shell);
  assert.deepEqual(Resolve(null), Shell); // unreadable
});

test('an extensionless file is sniffed from the disk by default', (t) => {
  const Dir = tempDir(t);
  const WithShebang = path.join(Dir, 'with-shebang');
  const Plain = path.join(Dir, 'plain');
  fs.writeFileSync(WithShebang, '#!/bin/zsh\necho hi\n');
  fs.writeFileSync(Plain, 'echo hi\n');
  assert.deepEqual(ResolveScriptLauncher(WithShebang, 'linux'), { command: WithShebang, args: [] });
  assert.deepEqual(ResolveScriptLauncher(Plain, 'linux'), { command: '/bin/sh', args: [Plain] });
  const Missing = path.join(Dir, 'missing');
  assert.deepEqual(ResolveScriptLauncher(Missing, 'linux'), {
    command: '/bin/sh',
    args: [Missing],
  });
});

test('the platform defaults to the running one, read when called', () => {
  const Expected = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
  assert.equal(ResolveScriptLauncher(path.join(os.tmpdir(), 'x.bat.sh')).command, Expected);
});

test('relative paths are normalized however they were authored', () => {
  assert.equal(NormalizeScriptRelativePath('.\\sub\\file.sh'), 'sub/file.sh');
  assert.equal(NormalizeScriptRelativePath('././a/b'), 'a/b');
  assert.equal(NormalizeScriptRelativePath('  a\\b  '), 'a/b');
  assert.equal(NormalizeScriptRelativePath(null), '');
  assert.equal(NormalizeScriptRelativePath(42), '');
});

test('a relative path with any way out of the folder is unsafe', () => {
  for (const Safe of ['run.sh', 'bin/run.sh', 'bin\\run.sh', './run.sh', 'a..b/run.sh']) {
    assert.equal(IsSafeRelativePath(Safe), true, Safe);
  }
  for (const Unsafe of [
    '',
    '   ',
    '..',
    '../x',
    'a/../b', // back inside the folder, but still refused
    '..\\x',
    'a\\..\\b',
    '/etc/passwd',
    '\\\\host\\share\\x',
    'C:\\x',
    'c:x',
    'a\0b',
    null,
    42,
  ]) {
    assert.equal(IsSafeRelativePath(Unsafe), false, String(Unsafe));
  }
});

test('ResolveContainedPath keeps the result strictly inside the base', () => {
  const Base = path.resolve(os.tmpdir(), 'scripts');
  assert.equal(ResolveContainedPath(Base, 'Deploy', 'run.sh'), path.join(Base, 'Deploy', 'run.sh'));
  assert.equal(ResolveContainedPath(Base, 'Deploy', '../Other/run.sh'), null);
  assert.equal(ResolveContainedPath(Base, '.'), null, 'the base itself is refused');
  assert.equal(ResolveContainedPath(Base, path.resolve('/etc/passwd')), null);
  assert.equal(ResolveContainedPath('', 'x'), null);
});

test('a script ID is one safe folder name', () => {
  for (const ID of ['Deploy', 'restart-qlab', 'a..b']) assert.equal(IsSafeScriptID(ID), true, ID);
  for (const ID of ['', '..', '../evil', 'a/b', 'a\\b', '/abs', 'C:x', null, 42]) {
    assert.equal(IsSafeScriptID(ID), false, String(ID));
  }
  const Root = path.resolve(os.tmpdir(), 'scripts');
  assert.equal(ResolveScriptFolder(Root, 'Deploy'), path.join(Root, 'Deploy'));
  assert.equal(ResolveScriptFolder(Root, 'a/b'), null);
  assert.equal(ResolveScriptFolder(Root, '.'), null);
});

test('ResolveScriptFile normalizes the path and refuses anything that escapes', () => {
  const Root = path.resolve(os.tmpdir(), 'scripts');
  const Deploy = path.join(Root, 'Deploy');
  assert.equal(ResolveScriptFile(Root, 'Deploy', 'run.sh'), path.join(Deploy, 'run.sh'));
  // A Windows-authored path finds the same file on macOS and Linux.
  assert.equal(
    ResolveScriptFile(Root, 'Deploy', '.\\bin\\run.sh'),
    path.join(Deploy, 'bin', 'run.sh')
  );
  assert.equal(ResolveScriptFile(Root, 'Deploy', '../Other/run.sh'), null);
  assert.equal(ResolveScriptFile(Root, 'Deploy', 'bin/../run.sh'), null);
  assert.equal(ResolveScriptFile(Root, 'Deploy', '..\\..\\etc\\passwd'), null);
  assert.equal(ResolveScriptFile(Root, 'Deploy', path.resolve('/etc/passwd')), null);
  assert.equal(ResolveScriptFile(Root, 'Deploy', './'), null);
  assert.equal(ResolveScriptFile(Root, 'Deploy', ''), null);
  assert.equal(ResolveScriptFile(Root, 'Deploy', 7), null);
  assert.equal(ResolveScriptFile(Root, '../evil', 'x.sh'), null);
  assert.equal(ResolveScriptFile(Root, 'a/b', 'x.sh'), null);
});
