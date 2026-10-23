const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { Client } = require('ssh2');
const { defaultShell } = require('./platform.cjs');
const { connectionError } = require('./network-error.cjs');
const { localCwd, execText, loginCommand, CwdParser, parseLsof, validDirectory } = require('./cwd.cjs');

class Sessions {
  constructor(store, emit) {
    this.store = store;
    this.emit = emit;
    this.items = new Map();
    this.challenges = new Map();
    this.activeId = null;
    this.cwdTimer = setInterval(() => { void this.refreshCwd(this.activeId); }, 1000);
    this.cwdTimer.unref();
  }
  state(item, status, detail = '') {
    item.status = status;
    this.emit('session:state', { id: item.id, status, detail });
  }
  output(item, data) {
    // Decode split UTF-8 characters with a persistent decoder, not Buffer.toString per packet.
    const decoded = typeof data === 'string' ? data : item.decoder.write(data);
    const text = item.cwdParser ? item.cwdParser.push(decoded) : decoded;
    if (!text) return;
    item.pending += text.length;
    this.emit('session:data', { id: item.id, data: text });
    if (item.pending > 128 * 1024) { item.stream?.pause(); item.stream?.stderr?.pause(); }
  }
  ack(id, amount) {
    const item = this.items.get(id);
    if (!item) return;
    item.pending = Math.max(0, item.pending - Math.max(0, Math.min(Number(amount) || 0, 1024 * 1024)));
    if (item.pending < 32 * 1024) { item.stream?.resume(); item.stream?.stderr?.resume(); }
  }
  start(input) {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(input.id) || this.items.has(input.id)) throw new Error('会话 ID 无效或重复');
    if (this.items.size >= 32) throw new Error('最多同时打开 32 个会话');
    const item = {
      id: input.id, type: input.type, pending: 0, status: 'connecting',
      decoder: new (require('node:string_decoder').StringDecoder)('utf8'),
      cwdToken: crypto.randomBytes(16).toString('hex'), cwdRevision: 0, cwdFailures: 0,
    };
    item.cwdParser = new CwdParser(item.cwdToken, event => {
      if (event.pid) item.shellPid = event.pid;
      this.reportCwd(item, event.directory, event.source);
    });
    this.items.set(item.id, item);
    this.state(item, 'connecting');
    try {
      if (input.type === 'local') this.local(item, input);
      else if (input.type === 'ssh') this.ssh(item, input).catch(error => {
        if (this.items.has(item.id)) { this.state(item, 'error', error.message); this.close(item.id, false); }
      });
      else throw new Error('不支持的会话类型');
    } catch (error) {
      this.close(item.id);
      throw error;
    }
    return { id: item.id };
  }
  local(item, input) {
    const pty = require('node-pty');
    const shell = defaultShell();
    const cwd = input.cwd || os.homedir();
    if (!fs.statSync(cwd).isDirectory()) throw new Error('终端工作目录不存在');
    const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'MTerminal' };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.MTERMINAL_DEV_URL;
    const proc = pty.spawn(shell.file, shell.args, {
      name: 'xterm-256color', cols: input.cols || 100, rows: input.rows || 30,
      cwd, env,
    });
    item.proc = proc;
    this.reportCwd(item, fs.realpathSync(cwd), 'process');
    item.stream = proc;
    proc.onData(data => this.output(item, data));
    proc.onExit(({ exitCode }) => {
      if (!this.items.has(item.id)) return;
      this.state(item, 'exited', `进程已退出 · ${exitCode}`);
      this.items.delete(item.id);
    });
    this.state(item, 'ready', shell.label);
    if (this.activeId === item.id) void this.refreshCwd(item.id);
  }
  async ssh(item, input) {
    const host = this.store.list().find(host => host.id === input.hostId);
    if (!host) throw new Error('主机不存在，请先保存主机');
    const secret = input.useSavedSecret && host.hasSecret ? await this.store.secret(host.id) : (input.secret || '');
    if (!this.items.has(item.id)) return;
    item.host = host;
    const conn = item.conn = new Client();
    const config = {
      host: host.hostname, port: host.port, username: host.username,
      readyTimeout: 120000, keepaliveInterval: 15000, keepaliveCountMax: 3,
      hostVerifier: (raw, callback) => {
        const fingerprint = 'SHA256:' + crypto.createHash('sha256').update(raw).digest('base64').replace(/=+$/, '');
        const previous = this.store.fingerprint(host.hostname, host.port);
        if (fingerprint === previous) return callback(true);
        const challengeId = crypto.randomUUID();
        const timer = setTimeout(() => this.resolveTrust(challengeId, 'reject'), 90000);
        this.challenges.set(challengeId, { item, host, fingerprint, callback, timer });
        this.emit('host:verify', {
          challengeId, sessionId: item.id, hostname: host.hostname, port: host.port,
          fingerprint, previous: previous || null, changed: !!previous,
        });
      },
    };
    if (host.auth === 'key') {
      if (!host.privateKeyPath) throw new Error('请选择 SSH 私钥');
      config.privateKey = fs.readFileSync(host.privateKeyPath);
      if (secret) config.passphrase = secret;
    } else config.password = secret;
    conn.once('ready', async () => {
      if (!this.items.has(item.id)) return conn.end();
      if (input.saveSecret && secret) {
        void this.store.setSecret(host.id, secret).then(() => this.emit('hosts:changed', {})).catch(error => this.emit('notice', { message: error.message }));
      }
      try { item.remoteOS = (await execText(conn, 'uname -s')).split(/\r?\n/).find(line => ['Linux', 'Darwin'].includes(line.trim()))?.trim() || 'unknown'; }
      catch { item.remoteOS = 'unknown'; }
      if (!this.items.has(item.id)) return;
      const openShell = callback => {
        const pty = { term: 'xterm-256color', cols: input.cols || 100, rows: input.rows || 30 };
        if (['Linux', 'Darwin'].includes(item.remoteOS)) {
          conn.exec(loginCommand(item.cwdToken), { pty }, (error, stream) => {
            if (error) conn.shell(pty, callback); else callback(null, stream);
          });
        } else conn.shell(pty, callback);
      };
      openShell((error, stream) => {
        if (error) { this.state(item, 'error', error.message); this.close(item.id, false); return; }
        if (!this.items.has(item.id)) { stream.close(); return; }
        item.stream = stream;
        stream.on('data', data => this.output(item, data));
        stream.stderr.on('data', data => this.output(item, data));
        stream.once('close', () => { if (this.items.has(item.id)) this.close(item.id); });
        this.state(item, 'ready', `${host.username}@${host.hostname}`);
      });
    });
    conn.on('error', error => {
      if (this.items.has(item.id)) {
        this.state(item, 'error', connectionError(error, host));
        this.close(item.id, false);
      }
    });
    conn.once('close', () => {
      if (this.items.has(item.id)) this.close(item.id);
    });
    conn.connect(config);
  }
  resolveTrust(id, decision) {
    const challenge = this.challenges.get(id);
    if (!challenge) return;
    clearTimeout(challenge.timer);
    this.challenges.delete(id);
    let accepted = decision === 'once' || decision === 'save';
    if (decision === 'save') {
      try { this.store.trust(challenge.host.hostname, challenge.host.port, challenge.fingerprint); }
      catch (error) { accepted = false; this.emit('notice', { message: error.message }); }
    }
    challenge.callback(accepted);
    this.emit('host:resolved', { challengeId: id });
  }
  write(id, data) {
    const item = this.items.get(id);
    if (!item || item.status !== 'ready' || typeof data !== 'string' || data.length > 1024 * 1024) return;
    if (item.proc) item.proc.write(data);
    else item.stream.write(data);
  }
  resize(id, cols, rows) {
    const item = this.items.get(id);
    if (!item) return;
    cols = Math.max(2, Math.min(1000, Math.floor(cols) || 80));
    rows = Math.max(1, Math.min(500, Math.floor(rows) || 24));
    if (item.proc) item.proc.resize(cols, rows);
    else item.stream?.setWindow(rows, cols, 0, 0);
  }
  reportCwd(item, directory, source, force = false) {
    if (this.items.get(item.id) !== item || !validDirectory(directory)) return;
    if (item.cwd === directory && !force) return;
    item.cwd = directory;
    item.cwdSource = source;
    this.emit('session:cwd', { id: item.id, directory, source, revision: ++item.cwdRevision });
  }
  activate(id) {
    this.activeId = id || null;
    const item = this.items.get(id);
    if (!item) return;
    item.cwdFailures = 0;
    if (item.cwd) this.reportCwd(item, item.cwd, item.cwdSource, true);
    void this.refreshCwd(id);
  }
  async refreshCwd(id) {
    const item = this.items.get(id);
    if (!item || item.status !== 'ready' || item.cwdReading || item.cwdFailures >= 3) return;
    item.cwdReading = true;
    try {
      let directory;
      if (item.proc) directory = await localCwd(item.proc.pid);
      else if (item.shellPid && item.remoteOS === 'Darwin') {
        directory = parseLsof(await execText(item.conn, `/usr/sbin/lsof -a -p ${item.shellPid} -d cwd -F0n`));
      } else if (item.shellPid && item.remoteOS === 'Linux') {
        const sftp = await this.sftp(id);
        directory = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Directory query timed out')), 3000);
          sftp.readlink(`/proc/${item.shellPid}/cwd`, (error, value) => { clearTimeout(timer); error ? reject(error) : resolve(value); });
        }).catch(async () => (await execText(item.conn, `readlink /proc/${item.shellPid}/cwd`)).replace(/\r?\n$/, ''));
      }
      if (directory) this.reportCwd(item, directory, 'process');
      item.cwdFailures = 0;
    } catch { item.cwdFailures++; }
    finally { item.cwdReading = false; }
  }
  async sftp(id) {
    const item = this.items.get(id);
    if (!item || !item.conn || item.status !== 'ready') throw new Error('SSH 尚未连接');
    if (!item.sftpPromise) {
      item.sftpPromise = new Promise((resolve, reject) => item.conn.sftp((error, sftp) => {
        if (error) { item.sftpPromise = null; reject(error); }
        else resolve(sftp);
      }));
    }
    return item.sftpPromise;
  }
  close(id, notify = true) {
    const item = this.items.get(id);
    if (!item) return;
    this.items.delete(id);
    for (const [challengeId, challenge] of this.challenges) {
      if (challenge.item.id === id) this.resolveTrust(challengeId, 'reject');
    }
    this.onClose?.(id);
    try { item.proc?.kill(); } catch {}
    try { item.stream?.close?.(); } catch {}
    try { item.conn?.end(); } catch {}
    // A stalled transport must not keep the application alive indefinitely.
    if (item.conn) { const timer = setTimeout(() => item.conn.destroy(), 1500); timer.unref(); }
    if (notify) this.state(item, 'exited', '连接已关闭');
  }
  dispose() { clearInterval(this.cwdTimer); for (const id of [...this.items.keys()]) this.close(id); }
}
module.exports = { Sessions };
