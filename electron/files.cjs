const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');

function call(sftp, method, ...args) {
  return new Promise((resolve, reject) => sftp[method](...args, (error, value) => error ? reject(error) : resolve(value)));
}
function validName(name) {
  if (typeof name !== 'string' || !name.trim() || name === '.' || name === '..' || /[/\\\0]/.test(name)) {
    throw new Error('名称不能为空，也不能包含 / 或 \\');
  }
  return name;
}
function validPath(value) {
  if (typeof value !== 'string' || value.includes('\0') || value.length > 32768) throw new Error('无效的文件路径');
  return value;
}
async function readLimited(stream) {
  const chunks = []; let bytes = 0;
  for await (const chunk of stream) {
    bytes += chunk.length;
    if (bytes > 1024 * 1024) throw new Error('文件超过 1 MiB 编辑上限');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
class Files {
  constructor(sessions, emit, confirmOverwrite, trash) {
    this.sessions = sessions;
    this.emit = emit;
    this.confirmOverwrite = confirmOverwrite;
    this.trash = trash;
    this.transfers = new Map();
    sessions.onClose = id => {
      for (const task of this.transfers.values()) if (task.sessionId === id && ['queued', 'running'].includes(task.status)) task.controller.abort();
    };
  }
  async list({ side, sessionId, directory }) {
    let entries;
    let real;
    if (side === 'remote') {
      const sftp = await this.sessions.sftp(sessionId);
      let target = validPath(directory || '.');
      if (target === '~') target = '.';
      else if (target.startsWith('~/')) target = path.posix.join(await call(sftp, 'realpath', '.'), target.slice(2));
      real = await call(sftp, 'realpath', target);
      entries = (await call(sftp, 'readdir', real)).filter(e => e.filename !== '.' && e.filename !== '..').map(entry => ({
        name: entry.filename, directory: entry.attrs.isDirectory(), symlink: entry.attrs.isSymbolicLink(),
        size: entry.attrs.size, modified: entry.attrs.mtime * 1000, mode: entry.attrs.mode,
      }));
    } else {
      real = await fsp.realpath(validPath(directory || os.homedir()).replace(/^~(?=[\\/]|$)/, os.homedir()));
      const names = await fsp.readdir(real, { withFileTypes: true });
      entries = await Promise.all(names.map(async entry => {
        try {
          const filename = path.join(real, entry.name);
          const stat = await fsp.lstat(filename);
          let directory = stat.isDirectory();
          if (stat.isSymbolicLink()) {
            try { directory = (await fsp.stat(filename)).isDirectory(); } catch {}
          }
          return { name: entry.name, directory, symlink: stat.isSymbolicLink(), size: stat.size, modified: stat.mtimeMs, mode: stat.mode };
        } catch { return null; }
      }));
      entries = entries.filter(Boolean);
    }
    entries.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
    return { directory: real, entries };
  }
  async mutate({ side, sessionId, action, directory, name, nextName }) {
    validPath(directory);
    validName(name);
    const filename = (side === 'remote' ? path.posix : path).join(directory, name);
    if (side === 'remote') {
      const sftp = await this.sessions.sftp(sessionId);
      if (action === 'mkdir') await call(sftp, 'mkdir', filename);
      else if (action === 'touch') { const handle = await call(sftp, 'open', filename, 'wx', 0o600); await call(sftp, 'close', handle); }
      else if (action === 'rename') {
        const target = path.posix.join(directory, validName(nextName));
        try { await call(sftp, 'lstat', target); throw new Error('目标名称已存在'); }
        catch (error) { if (error.code !== 2) throw error; }
        await call(sftp, 'rename', filename, target);
      } else if (action === 'delete') {
        const stat = await call(sftp, 'lstat', filename);
        await call(sftp, stat.isDirectory() ? 'rmdir' : 'unlink', filename);
      } else throw new Error('不支持的文件操作');
    } else {
      if (action === 'mkdir') await fsp.mkdir(filename);
      else if (action === 'touch') { const handle = await fsp.open(filename, 'wx', 0o600); await handle.close(); }
      else if (action === 'rename') {
        const target = path.join(directory, validName(nextName));
        try { await fsp.lstat(target); throw new Error('目标名称已存在'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        await fsp.rename(filename, target);
      } else if (action === 'delete') await this.trash(filename);
      else throw new Error('不支持的文件操作');
    }
  }
  async readText({ side, sessionId, filename }) {
    validPath(filename);
    let buffer;
    if (side === 'remote') {
      const sftp = await this.sessions.sftp(sessionId);
      const stat = await call(sftp, 'stat', filename);
      if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('编辑器支持不超过 1 MiB 的普通文本文件');
      buffer = await readLimited(sftp.createReadStream(filename));
    } else {
      const stat = await fsp.stat(filename);
      if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('编辑器支持不超过 1 MiB 的普通文本文件');
      buffer = await readLimited(fs.createReadStream(filename));
    }
    if (buffer.length > 1024 * 1024 || buffer.includes(0)) throw new Error('文件过大或包含二进制内容');
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
    catch { throw new Error('当前编辑器仅支持 UTF-8 文本'); }
    return { text, revision: crypto.createHash('sha256').update(buffer).digest('hex') };
  }
  async writeText({ side, sessionId, filename, text, revision }) {
    validPath(filename);
    if (typeof text !== 'string' || Buffer.byteLength(text) > 1024 * 1024) throw new Error('文件超过编辑上限');
    const current = await this.readText({ side, sessionId, filename });
    if (current.revision !== revision) throw new Error('文件已在其他地方修改，请重新打开后再编辑');
    // Commit through a sibling temporary file so interrupted writes preserve the original.
    // Resolve symlinks first, preserving the link itself and the target's permission bits.
    const sftp = side === 'remote' ? await this.sessions.sftp(sessionId) : null;
    const target = sftp ? await call(sftp, 'realpath', filename) : await fsp.realpath(filename);
    const stat = sftp ? await call(sftp, 'stat', target) : await fsp.stat(target);
    const temporary = `${target}.mterminal-${crypto.randomUUID()}.part`;
    try {
      if (sftp) {
        await call(sftp, 'writeFile', temporary, text, { encoding: 'utf8', flag: 'wx', mode: stat.mode & 0o777 });
        try { await call(sftp, 'ext_openssh_rename', temporary, target); }
        catch { throw new Error('服务器不支持原子保存，原文件已保留'); }
      } else {
        await fsp.writeFile(temporary, text, { encoding: 'utf8', flag: 'wx', mode: stat.mode & 0o777 });
        await fsp.rename(temporary, target);
      }
    } catch (error) {
      try { if (sftp) await call(sftp, 'unlink', temporary); else await fsp.unlink(temporary); } catch {}
      throw error;
    }
    return { revision: crypto.createHash('sha256').update(text).digest('hex') };
  }
  update(task, patch) {
    Object.assign(task, patch);
    const { controller, ...publicTask } = task;
    this.emit('transfer:update', publicTask);
  }
  async transfer({ direction, sessionId, sources, directory }) {
    if (!['upload', 'download'].includes(direction) || !Array.isArray(sources) || sources.length > 100) throw new Error('无效的传输请求');
    validPath(directory);
    if ([...this.transfers.values()].filter(task => ['queued', 'running'].includes(task.status)).length + sources.length > 100) throw new Error('传输队列已满');
    const sftp = await this.sessions.sftp(sessionId);
    const plans = [];
    for (const source of sources) {
      validPath(source);
      const name = (direction === 'upload' ? path : path.posix).basename(source);
      validName(name);
      const stat = direction === 'upload' ? await fsp.stat(source) : await call(sftp, 'stat', source);
      if (!stat.isFile()) throw new Error('当前支持普通文件传输；文件夹请先打包');
      const target = (direction === 'upload' ? path.posix : path).join(directory, name);
      let exists = false;
      try {
        const targetStat = direction === 'upload' ? await call(sftp, 'lstat', target) : await fsp.lstat(target);
        if (!targetStat.isFile() || targetStat.isSymbolicLink()) throw new Error(`目标不是普通文件：${name}`);
        exists = true;
      } catch (error) {
        if (error.code !== 2 && error.code !== 'ENOENT') throw error;
      }
      plans.push({ source, target, name, total: stat.size, overwrite: exists });
    }
    const conflicts = plans.filter(plan => plan.overwrite);
    if (conflicts.length && !await this.confirmOverwrite(conflicts.map(plan => plan.name))) return [];
    const tasks = plans.map(plan => ({
      id: crypto.randomUUID(), sessionId, direction, ...plan, bytes: 0,
      status: 'queued', controller: new AbortController(), startedAt: Date.now(),
    }));
    for (const task of tasks) { this.transfers.set(task.id, task); this.update(task, {}); }
    // Sequential execution bounds open file descriptors and SFTP channel pressure.
    this.queue = (this.queue || Promise.resolve()).then(async () => {
      for (const task of tasks) await this.run(task, sftp);
      const finished = [...this.transfers.values()].filter(task => !['queued', 'running'].includes(task.status));
      for (const task of finished.slice(0, Math.max(0, finished.length - 100))) this.transfers.delete(task.id);
    }).catch(() => {});
    return tasks.map(task => task.id);
  }
  async run(task, sftp) {
    const temporary = `${task.target}.mterminal-${task.id}.part`;
    const { signal } = task.controller;
    try {
      signal.throwIfAborted();
      this.update(task, { status: 'running', startedAt: Date.now() });
      const upload = task.direction === 'upload';
      const reader = upload ? fs.createReadStream(task.source) : sftp.createReadStream(task.source);
      const writer = upload ? sftp.createWriteStream(temporary, { flags: 'wx', mode: 0o600 }) : fs.createWriteStream(temporary, { flags: 'wx', mode: 0o600 });
      let last = 0;
      reader.on('data', chunk => {
        task.bytes += chunk.length;
        if (Date.now() - last > 100) { last = Date.now(); this.update(task, {}); }
      });
      await pipeline(reader, writer, { signal });
      signal.throwIfAborted();
      if (upload) {
        if (task.overwrite) {
          try { await call(sftp, 'ext_openssh_rename', temporary, task.target); }
          catch { throw new Error('服务器不支持原子替换，请重命名目标文件后重试'); }
        } else await call(sftp, 'rename', temporary, task.target);
      } else {
        // Re-check collision for a file created after the initial confirmation.
        if (!task.overwrite) {
          try { await fsp.link(temporary, task.target); }
          catch (error) {
            if (!['EPERM', 'EXDEV', 'ENOTSUP', 'EOPNOTSUPP'].includes(error.code)) throw error;
            // FAT/exFAT and some network shares do not implement hard links.
            await fsp.copyFile(temporary, task.target, fs.constants.COPYFILE_EXCL);
          }
          await fsp.unlink(temporary);
        } else await fsp.rename(temporary, task.target);
      }
      this.update(task, { status: 'done', bytes: task.total });
    } catch (error) {
      this.update(task, { status: signal.aborted ? 'cancelled' : 'error', error: signal.aborted ? '已取消' : error.message });
      try { if (task.direction === 'upload') await call(sftp, 'unlink', temporary); else await fsp.unlink(temporary); } catch {}
    }
  }
  cancel(id) { this.transfers.get(id)?.controller.abort(); }
  dispose() { for (const task of this.transfers.values()) task.controller.abort(); }
}
module.exports = { Files, call, validName };
