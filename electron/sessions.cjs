const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { StringDecoder } = require('node:string_decoder');
const { Client } = require('ssh2');
const { defaultShell } = require('./platform.cjs');
const { connectionError } = require('./network-error.cjs');
const { localCwd, execText, loginCommand, CwdParser, parseLsof, validDirectory } = require('./cwd.cjs');

const RETRY_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000];
const isTransportLoss = error => !error || ['client-socket', 'client-timeout', 'client-dns'].includes(error.level)
  || error.code === 10 // SSH_DISCONNECT_CONNECTION_LOST
  || (error.level === 'protocol' && error.message === 'Connection lost before handshake');

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
      cols: 100, rows: 30, cwdRevision: 0, cwdFailures: 0,
    };
    this.items.set(item.id, item);
    this.resize(item.id, input.cols || 100, input.rows || 30);
    this.state(item, 'connecting');
    try {
      if (input.type === 'local') { this.resetOutput(item); this.local(item, input); }
      else if (input.type === 'ssh') this.ssh(item, input).catch(error => {
        if (this.items.get(item.id) === item) { this.state(item, 'error', error.message); this.close(item.id, false); }
      });
      else throw new Error('不支持的会话类型');
    } catch (error) {
      this.close(item.id);
      throw error;
    }
    return { id: item.id };
  }
  resetOutput(item) {
    item.decoder = new StringDecoder('utf8');
    item.cwdToken = crypto.randomBytes(16).toString('hex');
    item.cwdParser = new CwdParser(item.cwdToken, event => {
      if (event.pid) item.shellPid = event.pid;
      this.reportCwd(item, event.directory, event.source);
    });
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
      name: 'xterm-256color', cols: item.cols, rows: item.rows,
      cwd, env,
    });
    item.proc = proc;
    this.reportCwd(item, fs.realpathSync(cwd), 'process');
    item.stream = proc;
    proc.onData(data => this.output(item, data));
    proc.onExit(({ exitCode }) => {
      if (this.items.get(item.id) !== item) return;
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
    if (this.items.get(item.id) !== item) return;
    item.host = host;
    // Keep credentials and any one-time host approval only for the lifetime of this tab.
    item.ssh = { secret, saveSecret: input.saveSecret, retries: 0 };
    this.connectSsh(item);
  }
  connectSsh(item) {
    const { host, ssh } = item;
    const reconnecting = !!ssh.fingerprint;
    const conn = item.conn = new Client();
    const attempt = item.attempt = {};
    const current = () => this.items.get(item.id) === item && item.attempt === attempt;
    this.resetOutput(item);
    const finish = error => {
      if (!current()) return;
      if (attempt.exited) return this.close(item.id);
      if (attempt.hostKeyChanged) error = new Error('服务器的 SSH 指纹已变更。请手动重新连接并确认新指纹。');
      if (ssh.fingerprint && isTransportLoss(error)) {
        const reason = error?.message || 'SSH 连接已断开';
        this.releaseSsh(item);
        this.onDisconnect?.(item.id);
        this.scheduleReconnect(item, reason);
      } else {
        this.state(item, 'error', error ? connectionError(error, host) : 'SSH 连接已断开');
        this.close(item.id, false);
      }
    };
    const accept = (callback, fingerprint) => {
      attempt.fingerprint = fingerprint;
      callback(true);
    };
    const config = {
      host: host.hostname, port: host.port, username: host.username,
      readyTimeout: reconnecting ? 12000 : 120000, keepaliveInterval: 5000, keepaliveCountMax: 3,
      hostVerifier: (raw, callback) => {
        if (!current()) return callback(false);
        const fingerprint = 'SHA256:' + crypto.createHash('sha256').update(raw).digest('base64').replace(/=+$/, '');
        const pinned = ssh.fingerprint || attempt.fingerprint;
        if (pinned) {
          if (fingerprint === pinned) return accept(callback, fingerprint);
          attempt.hostKeyChanged = true;
          return callback(false);
        }
        const previous = this.store.fingerprint(host.hostname, host.port);
        if (fingerprint === previous) return accept(callback, fingerprint);
        const challengeId = crypto.randomUUID();
        const timer = setTimeout(() => this.resolveTrust(challengeId, 'reject'), 90000);
        this.challenges.set(challengeId, { item, host, fingerprint, timer, callback: accepted => {
          if (accepted && current()) accept(callback, fingerprint);
          else callback(false);
        } });
        this.emit('host:verify', {
          challengeId, sessionId: item.id, hostname: host.hostname, port: host.port,
          fingerprint, previous: previous || null, changed: !!previous,
        });
      },
    };
    conn.once('ready', async () => {
      if (!current()) return;
      let remoteOS = 'unknown';
      try { remoteOS = (await execText(conn, 'uname -s')).split(/\r?\n/).find(line => ['Linux', 'Darwin'].includes(line.trim()))?.trim() || 'unknown'; } catch {}
      if (!current()) return;
      item.remoteOS = remoteOS;
      const pty = { term: 'xterm-256color', cols: item.cols, rows: item.rows };
      const timeout = new Error('等待 SSH 终端超时');
      timeout.level = 'client-timeout';
      attempt.shellTimer = setTimeout(() => finish(timeout), 12000);
      const opened = (error, stream) => {
        if (!current()) { stream?.close(); return; }
        if (error) { finish(error); return; }
        clearTimeout(attempt.shellTimer);
        item.stream = stream;
        ssh.fingerprint = attempt.fingerprint;
        ssh.retries = 0;
        if (ssh.saveSecret && ssh.secret) {
          ssh.saveSecret = false;
          void this.store.setSecret(host.id, ssh.secret).then(() => this.emit('hosts:changed', {})).catch(error => this.emit('notice', { message: error.message }));
        }
        stream.on('data', data => { if (current()) this.output(item, data); });
        stream.stderr.on('data', data => { if (current()) this.output(item, data); });
        stream.on('error', finish);
        stream.once('exit', () => { attempt.exited = true; });
        // ssh2 emits the client close before cleaning up channels on transport loss.
        // A close from the channel itself is the server ending the shell.
        stream.once('close', () => { if (current()) this.close(item.id); });
        this.state(item, 'ready', `${host.username}@${host.hostname}`);
        if (pty.cols !== item.cols || pty.rows !== item.rows) stream.setWindow(item.rows, item.cols, 0, 0);
      };
      const shell = () => {
        if (!current()) return;
        try { conn.shell(pty, opened); } catch (error) { finish(error); }
      };
      try {
        if (['Linux', 'Darwin'].includes(remoteOS)) {
          conn.exec(loginCommand(item.cwdToken), { pty }, (error, stream) => {
            if (error) shell(); else opened(null, stream);
          });
        } else shell();
      } catch (error) { finish(error); }
    });
    conn.on('error', finish);
    conn.once('end', () => finish());
    conn.once('close', () => finish());
    try {
      if (host.auth === 'key') {
        if (!host.privateKeyPath) throw new Error('请选择 SSH 私钥');
        config.privateKey = fs.readFileSync(host.privateKeyPath);
        if (ssh.secret) config.passphrase = ssh.secret;
      } else config.password = ssh.secret;
      conn.connect(config);
    } catch (error) { finish(error); }
  }
  scheduleReconnect(item, reason) {
    const ssh = item.ssh;
    const delay = RETRY_DELAYS[Math.min(ssh.retries, RETRY_DELAYS.length - 1)];
    ssh.retries++;
    ssh.timer = setTimeout(() => this.retrySsh(item), delay);
    ssh.timer.unref();
    this.state(item, 'reconnecting', `连接中断 · ${delay / 1000} 秒后重试（第 ${ssh.retries} 次）\n${reason}`);
  }
  retrySsh(item) {
    clearTimeout(item.ssh.timer);
    item.ssh.timer = null;
    this.state(item, 'reconnecting', `正在重新连接（第 ${item.ssh.retries} 次）…`);
    this.connectSsh(item);
  }
  networkOnline() {
    for (const item of this.items.values()) if (item.ssh?.timer) this.retrySsh(item);
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
    item.cols = cols;
    item.rows = rows;
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
    const { conn, shellPid, remoteOS } = item;
    const current = () => this.items.get(id) === item && item.conn === conn && item.status === 'ready';
    try {
      let directory;
      if (item.proc) directory = await localCwd(item.proc.pid);
      else if (shellPid && remoteOS === 'Darwin') {
        directory = parseLsof(await execText(conn, `/usr/sbin/lsof -a -p ${shellPid} -d cwd -F0n`));
      } else if (shellPid && remoteOS === 'Linux') {
        const sftp = await this.sftp(id);
        directory = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Directory query timed out')), 3000);
          sftp.readlink(`/proc/${shellPid}/cwd`, (error, value) => { clearTimeout(timer); error ? reject(error) : resolve(value); });
        }).catch(async () => current() ? (await execText(conn, `readlink /proc/${shellPid}/cwd`)).replace(/\r?\n$/, '') : null);
      }
      if (!current()) return;
      if (directory) this.reportCwd(item, directory, 'process');
      item.cwdFailures = 0;
    } catch { if (current()) item.cwdFailures++; }
    finally { if (current()) item.cwdReading = false; }
  }
  async sftp(id) {
    const item = this.items.get(id);
    if (!item || !item.conn || item.status !== 'ready') throw new Error('SSH 尚未连接');
    const { conn } = item;
    if (!item.sftpPromise) {
      item.sftpPromise = new Promise((resolve, reject) => conn.sftp((error, sftp) => error ? reject(error) : resolve(sftp))).catch(error => {
        if (item.conn === conn) item.sftpPromise = null;
        throw error;
      });
    }
    const sftp = await item.sftpPromise;
    if (item.conn !== conn) throw new Error('SSH 连接已断开');
    return sftp;
  }
  releaseSsh(item, graceful = false) {
    const { conn, stream, attempt } = item;
    item.attempt = item.conn = item.stream = item.sftpPromise = null;
    item.cwd = item.cwdSource = item.shellPid = item.remoteOS = undefined;
    item.cwdReading = false;
    item.cwdFailures = 0;
    clearTimeout(attempt?.shellTimer);
    for (const [challengeId, challenge] of this.challenges) {
      if (challenge.item === item) this.resolveTrust(challengeId, 'reject');
    }
    if (!conn) return;
    if (graceful) {
      try { stream?.close(); } catch {}
      try { conn.end(); } catch {}
      // Do not let a stalled peer keep the application alive.
      const timer = setTimeout(() => conn.destroy(), 1500);
      timer.unref();
    } else conn.destroy();
  }
  close(id, notify = true) {
    const item = this.items.get(id);
    if (!item) return;
    this.items.delete(id);
    this.onClose?.(id);
    try { item.proc?.kill(); } catch {}
    if (item.type === 'ssh') {
      clearTimeout(item.ssh?.timer);
      item.ssh = null;
      this.releaseSsh(item, notify);
    }
    if (notify) this.state(item, 'exited', '连接已关闭');
  }
  dispose() { clearInterval(this.cwdTimer); for (const id of [...this.items.keys()]) this.close(id); }
}
module.exports = { Sessions };
