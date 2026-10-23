const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../electron/store.cjs');
const { validName } = require('../electron/files.cjs');

test('profiles survive restart; authentication changes clear stored credentials', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mterminal-store-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const encryption = {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from('test-encrypted:' + value),
    decryptString: buffer => buffer.toString().replace('test-encrypted:', ''),
  };
  const store = new Store(directory, encryption);
  const host = store.save({ name: '测试', hostname: '127.0.0.1', username: 'tester', port: 2200 });
  await store.setSecret(host.id, 'test-password');
  store.trust('127.0.0.1', 2200, 'SHA256:example');
  const reopened = new Store(directory, encryption);
  assert.equal(await reopened.secret(host.id), 'test-password');
  assert.equal(reopened.list()[0].hasSecret, true);
  assert.equal(reopened.fingerprint('127.0.0.1', 2200), 'SHA256:example');
  reopened.save({ ...host, username: 'another-user' });
  assert.equal(await reopened.secret(host.id), '');
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(directory, 'profiles.json')).mode & 0o777, 0o600);
});

test('unavailable encryption never persists plaintext; invalid host and filenames are rejected', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mterminal-validation-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new Store(directory, { isEncryptionAvailable: () => false });
  const host = store.save({ hostname: 'example.test', username: 'tester' });
  await assert.rejects(() => store.setSecret(host.id, 'MUST_NOT_PERSIST'), /加密/);
  assert.ok(!fs.readFileSync(store.file, 'utf8').includes('MUST_NOT_PERSIST'));
  assert.throws(() => store.save({ hostname: 'host; evil command', username: 'tester' }));
  assert.throws(() => store.save({ hostname: 'host', username: 'tester', port: 70000 }));
  for (const name of ['..', '.', '', 'a/b', 'a\\b', '\0']) assert.throws(() => validName(name));
  assert.equal(validName('中文 文件.txt'), '中文 文件.txt');
});

test('an edited profile cannot receive credentials from a pending keychain operation', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mterminal-keychain-race-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let finish;
  const store = new Store(directory, {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: () => new Promise(resolve => { finish = resolve; }),
  });
  const host = store.save({ hostname: 'example.test', username: 'tester' });
  const saving = store.setSecret(host.id, 'old-host-secret');
  await new Promise(resolve => setImmediate(resolve));
  store.save({ ...host, hostname: 'changed.example.test' });
  finish(Buffer.from('encrypted-test-value'));
  await saving;
  assert.equal(store.list()[0].hasSecret, false);
});

test('split UTF-8 terminal packets preserve multibyte characters', () => {
  const { Sessions } = require('../electron/sessions.cjs');
  const events = [];
  const sessions = new Sessions({}, (_channel, event) => events.push(event));
  const item = { id: 'test', pending: 0, decoder: new (require('node:string_decoder').StringDecoder)('utf8') };
  const bytes = Buffer.from('中文🙂');
  for (const byte of bytes) sessions.output(item, Buffer.from([byte]));
  assert.equal(events.map(event => event.data).join(''), '中文🙂');
});
