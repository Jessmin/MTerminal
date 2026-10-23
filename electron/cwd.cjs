const fs = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');

function validDirectory(value) {
  return typeof value === 'string' && value.length <= 16384 && !/[\x00-\x1f\x7f]/.test(value)
    && (value.startsWith('/') || /^[a-z]:[\\/]/i.test(value) || value.startsWith('\\\\'));
}
function parseLsof(output) {
  return output.split('\0').map(field => field.replace(/^\n/, '')).find(field => field.startsWith('n/'))?.slice(1);
}
async function localCwd(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (process.platform === 'linux') return fs.readlink(`/proc/${pid}/cwd`);
  if (process.platform !== 'darwin') return null;
  return new Promise((resolve, reject) => execFile('/usr/sbin/lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-F0n'], {
    timeout: 1800, maxBuffer: 65536, encoding: 'utf8', env: { ...process.env, LC_ALL: 'en_US.UTF-8' },
  }, (error, output) => error ? reject(error) : resolve(parseLsof(output))));
}
function execText(connection, command, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const decoder = new StringDecoder('utf8');
    let channel; let text = ''; let settled = false;
    const finish = (error, value) => {
      if (settled) return; settled = true; clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => { finish(new Error('Directory query timed out')); channel?.close(); }, timeout);
    connection.exec(command, (error, stream) => {
      if (error) return finish(error);
      channel = stream;
      if (settled) { stream.close(); return; }
      stream.on('data', data => {
        text += decoder.write(data);
        if (text.length > 65536) { finish(new Error('Directory query too large')); stream.close(); }
      });
      stream.stderr.resume();
      stream.on('error', error => finish(error));
      stream.once('close', code => code ? finish(new Error('Directory query unavailable')) : finish(null, text + decoder.end()));
    });
  });
}
function loginCommand(token) {
  if (!/^[a-f0-9]{32}$/.test(token)) throw new Error('Invalid shell integration token');
  // The reported process execs the user's login shell: its PID is stable across exec.
  // No commands are injected into the interactive input and no rc files are changed.
  const body = `printf '\\033]777;MTerminal;${token};%s;%s\\007' "$$" "$PWD"; exec "\${SHELL:-/bin/sh}" -l`;
  return "/bin/sh -c '" + body.replace(/'/g, "'\\''") + "'";
}
class CwdParser {
  constructor(token, onDirectory) { this.token = token; this.onDirectory = onDirectory; this.buffer = ''; }
  push(text) {
    this.buffer += text;
    let output = '';
    while (this.buffer) {
      const start = this.buffer.indexOf('\x1b]');
      if (start < 0) {
        const hold = this.buffer.endsWith('\x1b') ? 1 : 0;
        output += this.buffer.slice(0, this.buffer.length - hold);
        this.buffer = hold ? '\x1b' : ''; break;
      }
      output += this.buffer.slice(0, start); this.buffer = this.buffer.slice(start);
      const end = /\x07|\x1b\\/.exec(this.buffer.slice(2));
      if (!end) {
        if (this.buffer.length > 32768) { output += this.buffer; this.buffer = ''; }
        break;
      }
      const payload = this.buffer.slice(2, 2 + end.index);
      const length = 2 + end.index + end[0].length;
      const prefix = `777;MTerminal;${this.token};`;
      let consumed = false;
      if (this.token && payload.startsWith(prefix)) {
        const value = payload.slice(prefix.length), separator = value.indexOf(';');
        const pid = Number(value.slice(0, separator)), directory = value.slice(separator + 1);
        if (separator > 0 && Number.isInteger(pid) && pid > 0 && validDirectory(directory)) {
          this.onDirectory({ pid, directory, source: 'process' }); consumed = true;
        }
      } else if (payload.startsWith('7;')) {
        try {
          const url = new URL(payload.slice(2));
          const directory = decodeURIComponent(url.pathname);
          if (url.protocol === 'file:' && validDirectory(directory)) this.onDirectory({ directory, source: 'osc7' });
        } catch {}
      }
      if (!consumed) output += this.buffer.slice(0, length);
      this.buffer = this.buffer.slice(length);
    }
    return output;
  }
}
module.exports = { localCwd, execText, loginCommand, CwdParser, parseLsof, validDirectory };
