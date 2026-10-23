const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

class Store {
  constructor(directory, encryption) {
    this.directory = directory;
    this.encryption = encryption;
    this.file = path.join(directory, 'profiles.json');
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.data = { version: 1, hosts: [], knownHosts: {}, secrets: {} };
    if (fs.existsSync(this.file)) {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.hosts)) throw new Error('主机配置文件格式不受支持');
      this.data = { ...this.data, ...data };
    }
  }
  persist() {
    const temp = `${this.file}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(temp, this.file);
  }
  list() { return this.data.hosts.map(host => ({ ...host, hasSecret: !!this.data.secrets[host.id] })); }
  save(input) {
    const text = (value, max = 300) => String(value ?? '').trim().slice(0, max);
    const id = input.id || crypto.randomUUID();
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw new Error('无效的主机 ID');
    const hostname = text(input.hostname);
    const username = text(input.username);
    const port = Number(input.port || 22);
    if (!hostname || /[\s/\\\0]/.test(hostname)) throw new Error('请填写有效的主机地址');
    if (!username || /[\r\n\0]/.test(username)) throw new Error('请填写有效的用户名');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口应为 1–65535');
    const host = {
      id, name: text(input.name) || hostname, hostname, port, username,
      group: text(input.group, 80) || '我的主机',
      auth: input.auth === 'key' ? 'key' : 'password',
      privateKeyPath: text(input.privateKeyPath, 4096).replace(/^~(?=[\\/]|$)/, require('node:os').homedir()),
      note: text(input.note, 2000),
    };
    const index = this.data.hosts.findIndex(item => item.id === id);
    if (index < 0) this.data.hosts.push(host);
    else {
      const previous = this.data.hosts[index];
      if (['hostname', 'port', 'username', 'auth', 'privateKeyPath'].some(key => previous[key] !== host[key])) {
        delete this.data.secrets[id];
      }
      this.data.hosts[index] = host;
    }
    this.persist();
    return this.list().find(item => item.id === id);
  }
  remove(id) {
    this.data.hosts = this.data.hosts.filter(item => item.id !== id);
    delete this.data.secrets[id];
    this.persist();
  }
  async setSecret(id, secret) {
    const hostAtStart = this.data.hosts.find(host => host.id === id);
    if (!hostAtStart) throw new Error('主机不存在');
    const available = this.encryption.isAsyncEncryptionAvailable
      ? await this.encryption.isAsyncEncryptionAvailable() : this.encryption.isEncryptionAvailable();
    if (!available || this.encryption.getSelectedStorageBackend?.() === 'basic_text') {
      throw new Error('系统加密存储不可用，请使用仅本次连接');
    }
    const ciphertext = this.encryption.encryptStringAsync
      ? await this.encryption.encryptStringAsync(secret) : this.encryption.encryptString(secret);
    // The host may have been removed or edited while the OS keychain was unlocking.
    if (this.data.hosts.find(host => host.id === id) !== hostAtStart) return;
    this.data.secrets[id] = ciphertext.toString('base64');
    this.persist();
  }
  async secret(id) {
    const value = this.data.secrets[id];
    if (!value) return '';
    try {
      if (this.encryption.decryptStringAsync) {
        const decrypted = await this.encryption.decryptStringAsync(Buffer.from(value, 'base64'));
        if (decrypted.shouldReEncrypt) await this.setSecret(id, decrypted.result);
        return decrypted.result;
      }
      return this.encryption.decryptString(Buffer.from(value, 'base64'));
    }
    catch { throw new Error('已保存的凭据无法解密，请重新输入'); }
  }
  forgetSecret(id) { delete this.data.secrets[id]; this.persist(); }
  fingerprint(host, port) { return this.data.knownHosts[JSON.stringify([host, port])]; }
  trust(host, port, fingerprint) {
    this.data.knownHosts[JSON.stringify([host, port])] = fingerprint;
    this.persist();
  }
}
module.exports = { Store };
