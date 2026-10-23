// Local-only SSH server with the operating system's real OpenSSH SFTP subsystem.
// Test credentials and temporary files never ship in the packaged application.
const { Server } = require('ssh2');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { Transform } = require('node:stream');

function startServer(root, port = 0) {
  const key = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
  const clients = new Set();
  const children = new Set();
  const server = new Server({ hostKeys: [key] }, client => {
    clients.add(client);
    client.on('error', () => {});
    client.on('close', () => clients.delete(client));
    client.on('authentication', context => {
      if (context.username === 'tester' && ((context.method === 'password' && context.password === 'integration-only') || context.method === 'publickey')) context.accept();
      else context.reject();
    });
    client.on('session', accept => {
      const session = accept();
      session.on('pty', accept => accept());
      session.on('window-change', accept => accept?.());
      const run = (stream, executable, args, slow = false) => {
        const child = spawn(executable, args, { cwd: root, env: { ...process.env, HOME: root, SHELL: '/bin/bash', PS1: 'fixture$ ' } });
        children.add(child);
        stream.pipe(child.stdin);
        const output = slow ? child.stdout.pipe(new Transform({ transform(chunk, encoding, callback) { setTimeout(() => callback(null, chunk), 2); } })) : child.stdout;
        output.pipe(stream); child.stderr.pipe(stream.stderr);
        stream.on('close', () => child.kill());
        child.on('exit', code => { children.delete(child); try { stream.exit(code || 0); stream.end(); } catch {} });
      };
      session.on('shell', accept => run(accept(), '/bin/sh', ['-i']));
      session.on('exec', (accept, _reject, info) => run(accept(), '/bin/sh', ['-c', info.command]));
      session.on('subsystem', (accept, reject, info) => {
        if (info.name !== 'sftp') return reject();
        run(accept(), '/usr/libexec/sftp-server', ['-d', root], true);
      });
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({
      port: server.address().port,
      close: () => new Promise(resolve => { for (const client of clients) client.end(); for (const child of children) child.kill(); server.close(resolve); }),
    }));
  });
}
module.exports = { startServer };
