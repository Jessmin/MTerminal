const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function defaultShell(platform = process.platform, env = process.env, exists = fs.existsSync) {
  if (platform === 'win32') {
    const root = env.SystemRoot || env.WINDIR || 'C:\\Windows';
    const powershell = path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    if (exists(powershell)) return { file: powershell, args: ['-NoLogo'], label: 'PowerShell' };
    return { file: env.ComSpec || path.win32.join(root, 'System32', 'cmd.exe'), args: [], label: 'Command Prompt' };
  }
  const file = os.userInfo().shell || env.SHELL || '/bin/sh';
  return { file, args: ['-l'], label: path.basename(file) };
}
module.exports = { defaultShell };
