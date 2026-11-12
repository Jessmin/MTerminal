// Local-only SSH server with the operating system's real OpenSSH SFTP subsystem.
// Test credentials and temporary files never ship in the packaged application.
const { Server } = require('ssh2');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { Transform } = require('node:stream');

function startServer(root, port = 0) {
  const key = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
  const sockets = new Set();
  const children = new Set();
  let online = true;
  let password = 'integration-only';
  let connectionAttempts = 0;
  let lastPty;
  const ssh = new Server({ hostKeys: [key] }, client => {
    client.on('error', () => {});
    client.on('authentication', context => {
      if (context.username === 'tester' && ((context.method === 'password' && context.password === password) || context.method === 'publickey')) context.accept();
      else context.reject();
    });
    client.on('session', accept => {
      const session = accept();
      session.on('pty', (accept, _reject, { cols, rows }) => {
        lastPty = { cols, rows };
        accept?.();
      });
      session.on('window-change', accept => accept?.());
      const run = (stream, executable, args, slow = false) => {
        const child = spawn(executable, args, { cwd: root, env: { ...process.env, HOME: root, SHELL: '/bin/bash', PS1: 'fixture$ ' } });
        children.add(child);
        stream.pipe(child.stdin);
        const output = slow ? child.stdout.pipe(new Transform({ transform(chunk, encoding, callback) { setTimeout(() => callback(null, chunk), 2); } })) : child.stdout;
        output.pipe(stream, { end: false }); child.stderr.pipe(stream.stderr);
        stream.on('close', () => child.kill());
        child.on('close', code => { children.delete(child); try { stream.exit(code || 0); stream.end(); } catch {} });
      };
      session.on('shell', accept => run(accept(), '/bin/sh', ['-i']));
      session.on('exec', (accept, _reject, info) => run(accept(), '/bin/sh', ['-c', info.command]));
      session.on('subsystem', (accept, reject, info) => {
        if (info.name !== 'sftp') return reject();
        run(accept(), '/usr/libexec/sftp-server', ['-d', root], true);
      });
    });
  });
  const disconnect = () => { for (const socket of sockets) socket.destroy(); };
  const server = net.createServer(socket => {
    connectionAttempts++;
    if (!online) return socket.destroy();
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    ssh.injectSocket(socket);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({
      port: server.address().port,
      get connectionAttempts() { return connectionAttempts; },
      get lastPty() { return lastPty; },
      setOnline(value) { online = value; if (!online) disconnect(); },
      setPassword(value) { password = value; },
      close: () => new Promise(resolve => { disconnect(); for (const child of children) child.kill(); server.close(resolve); }),
    }));
  });
}
module.exports = { startServer };
