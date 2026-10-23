const { test } = require('node:test');
const assert = require('node:assert/strict');
const { defaultShell } = require('../electron/platform.cjs');
const { join, parent } = require('../shared/paths.mjs');

test('Windows uses PowerShell without Unix flags, with ComSpec fallback', () => {
  const shell = defaultShell('win32', { SystemRoot: 'C:\\Windows' }, () => true);
  assert.equal(shell.file, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.deepEqual(shell.args, ['-NoLogo']);
  const fallback = defaultShell('win32', { ComSpec: 'D:\\System\\cmd.exe' }, () => false);
  assert.equal(fallback.file, 'D:\\System\\cmd.exe');
  assert.deepEqual(fallback.args, []);
});

test('local drive and UNC paths remain rooted while remote paths stay POSIX', () => {
  assert.equal(join('C:\\Users\\test', '文件.txt', 'local'), 'C:\\Users\\test\\文件.txt');
  assert.equal(join('C:\\', 'data', 'local'), 'C:\\data');
  assert.equal(parent('C:\\Users\\test', 'local'), 'C:\\Users');
  assert.equal(parent('C:\\Users', 'local'), 'C:\\');
  assert.equal(parent('C:\\', 'local'), 'C:\\');
  assert.equal(parent('C:/Users/test', 'local'), 'C:\\Users');
  assert.equal(parent('\\\\server\\share\\folder', 'local'), '\\\\server\\share\\');
  assert.equal(parent('\\\\server\\share\\', 'local'), '\\\\server\\share\\');
  assert.equal(join('/home/test', '文件.txt', 'remote'), '/home/test/文件.txt');
  assert.equal(parent('/home/test', 'remote'), '/home');
  assert.equal(parent('/', 'remote'), '/');
  assert.equal(join('C:/Users', 'test', 'remote'), 'C:/Users/test');
});
