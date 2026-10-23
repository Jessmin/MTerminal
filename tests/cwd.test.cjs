const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CwdParser, parseLsof, loginCommand, execText } = require('../electron/cwd.cjs');
const token = '0123456789abcdef0123456789abcdef';

test('authenticated shell markers survive packet splitting and stay out of terminal output', () => {
  const events = [], parser = new CwdParser(token, value => events.push(value));
  const input = `banner\r\n\x1b]777;MTerminal;${token};123;/home/中文 文件;目录\x07prompt$ `;
  const output = [...input].map(character => parser.push(character)).join('');
  assert.equal(output, 'banner\r\nprompt$ ');
  assert.deepEqual(events, [{ pid: 123, directory: '/home/中文 文件;目录', source: 'process' }]);
  assert.throws(() => loginCommand('not-a-token'));
});
test('OSC 7 and ST terminators are handled without consuming unrelated escape sequences', () => {
  const events = [], parser = new CwdParser(token, value => events.push(value));
  const color = '\x1b[32mgreen\x1b[0m';
  const osc = '\x1b]7;file://server/home/%E4%B8%AD%E6%96%87%20files\x1b\\';
  assert.equal(parser.push(color + osc), color + osc);
  assert.equal(events[0].directory, '/home/中文 files');
  parser.push(`\x1b]777;MTerminal;wrong;1;/ignored\x07`);
  parser.push('\x1b]7;https://server/ignored\x07');
  assert.equal(events.length, 1);
});
test('lsof field output preserves spaces and unicode paths', () => {
  assert.equal(parseLsof('p123\0\nfcwd\0n/private/tmp/中文 folder\0\n'), '/private/tmp/中文 folder');
  assert.equal(parseLsof('p123\0\n'), undefined);
});
test('SSH directory query preserves UTF-8 split across network packets', async () => {
  const { PassThrough } = require('node:stream');
  const stream = new PassThrough();
  stream.stderr = new PassThrough();
  const bytes = Buffer.from('/srv/中文 folder\n');
  const connection = { exec(_command, callback) {
    callback(null, stream);
    queueMicrotask(() => {
      for (const byte of bytes) stream.write(Buffer.from([byte]));
      stream.emit('close', 0);
    });
  } };
  assert.equal(await execText(connection, 'readlink /proc/123/cwd'), '/srv/中文 folder\n');
});
test('Linux tracking reads the interactive shell process rather than the SFTP default directory', async () => {
  const { Sessions } = require('../electron/sessions.cjs');
  const events = [], calls = [];
  const sessions = new Sessions({}, (channel, value) => events.push({ channel, ...value }));
  try {
    const item = { id: 'linux-shell', type: 'ssh', remoteOS: 'Linux', shellPid: 4321, status: 'ready', cwdRevision: 0, cwdFailures: 0 };
    sessions.items.set(item.id, item);
    sessions.sftp = async () => ({ readlink(filename, callback) { calls.push(filename); callback(null, '/srv/actual-shell-directory'); } });
    await sessions.refreshCwd(item.id);
    assert.deepEqual(calls, ['/proc/4321/cwd']);
    assert.equal(events[0].directory, '/srv/actual-shell-directory');
    sessions.items.clear();
  } finally { sessions.dispose(); }
});
