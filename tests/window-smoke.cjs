// Launch our application with an isolated profile and capture its own hidden render.
// This does not inspect or drive any existing app window or user desktop.
const { app, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mterminal-window-test-'));
app.setPath('userData', profile);
const workspace = path.join(profile, 'Workspace');
fs.mkdirSync(workspace);
process.env.HOME = workspace;
fs.mkdirSync(path.join(workspace, 'Projects'));
fs.mkdirSync(path.join(workspace, 'Downloads'));
fs.writeFileSync(path.join(workspace, 'README.md'), '# MTerminal render fixture\n');
const followed = path.join(workspace, 'Follow 中文 folder');
fs.mkdirSync(followed);
const calls = new Set();
const fileResults = [];
const resourceResults = [];
const errors = [];
let outputPackets = 0;
let sessionId;
const original = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => original(channel, async (...args) => {
  const result = await listener(...args);
  if (result.ok) calls.add(channel);
  else errors.push(channel + ': ' + result.error);
  if (channel === 'session:start' && result.ok) sessionId = result.value.id;
  if (channel === 'files:list' && result.ok) fileResults.push({ input: args[1], result: result.value });
  if (channel === 'resources:sample' && result.ok) resourceResults.push(result.value);
  return result;
});
const timeout = setTimeout(() => { console.error('Window smoke test timed out', [...calls], errors); app.exit(1); }, 30000);
app.on('browser-window-created', (_event, window) => {
  if (process.env.MTERMINAL_SMOKE_COMPACT === '1') window.setSize(1040, 680);
  // Keep the test window off the user's desktop while rendering through Chromium.
  window.show = () => {};
  const send = window.webContents.send.bind(window.webContents);
  window.webContents.send = (channel, ...args) => { if (channel === 'session:data') outputPackets++; return send(channel, ...args); };
  window.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  window.webContents.on('render-process-gone', (_event, detail) => errors.push('Renderer gone: ' + detail.reason));
  window.webContents.once('did-fail-load', (_event, code, description) => { errors.push(`${code}: ${description}`); });
  window.webContents.once('did-finish-load', async () => {
    try {
      // The test renders offscreen; model a visible document to exercise polling.
      await window.webContents.executeJavaScript("Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange'));");
      const start = Date.now();
      while ((!['app:info', 'hosts:list', 'session:start', 'files:list'].every(channel => calls.has(channel)) || outputPackets === 0 || resourceResults.length < 2) && Date.now() - start < 15000) {
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      if (errors.length) throw new Error(errors.join('\n'));
      for (const channel of ['app:info', 'hosts:list', 'session:start', 'files:list']) if (!calls.has(channel)) throw new Error('Missing renderer IPC: ' + channel);
      if (!outputPackets) throw new Error('Default PTY produced no output');
      const resource = resourceResults.at(-1);
      if (!resource || resource.cpuPercent === null || !(resource.cpuPercent >= 0 && resource.cpuPercent <= 100) || !(resource.memory.total > 0) || !(resource.disk?.total > 0)) throw new Error('Resource panel did not receive valid consecutive samples');
      if (resourceResults.some(value => value.sessionId !== sessionId)) throw new Error('Resource samples leaked across sessions');
      const sendCommand = data => ipcMain.emit('session:write', { sender: window.webContents, senderFrame: window.webContents.mainFrame }, sessionId, data);
      const waitFor = async (condition, label) => {
        const start = Date.now();
        while (!condition() && Date.now() - start < 8000) await new Promise(resolve => setTimeout(resolve, 30));
        if (!condition()) throw new Error(label);
      };
      sendCommand(`cd -- '${followed.replace(/'/g, "'\\''")}'\r`);
      await waitFor(() => fileResults.some(value => value.result.directory === fs.realpathSync(followed)), 'File pane did not follow terminal cd');
      sendCommand('touch auto-refresh-verified.txt\r');
      await waitFor(() => fileResults.some(value => value.result.entries.some(entry => entry.name === 'auto-refresh-verified.txt')), 'Command-created file did not auto-refresh');
      if (fileResults.some(value => value.input.side !== 'local' || value.input.sessionId !== sessionId)) throw new Error('File requests leaked to a different session');
      await new Promise(resolve => setTimeout(resolve, 700));
      const image = await window.webContents.capturePage();
      fs.mkdirSync(path.join(__dirname, '../artifacts'), { recursive: true });
      const filename = path.join(__dirname, process.env.MTERMINAL_SMOKE_COMPACT === '1' ? '../artifacts/window-smoke-compact.png' : '../artifacts/window-smoke.png');
      fs.writeFileSync(filename, image.toPNG());
      console.log('PASS renderer loads without console errors');
      console.log('PASS sandboxed preload / IPC / default local terminal / local file browser');
      console.log('PASS terminal cd → actual process cwd → renderer file navigation');
      console.log('PASS terminal touch → automatic file refresh; file requests scoped to the active session');
      console.log('PASS resource panel IPC, real CPU/memory/disk samples and active-session scope');
      console.log('Captured:', filename, image.getSize());
      clearTimeout(timeout);
      window.destroy();
      fs.rmSync(profile, { recursive: true, force: true });
      app.exit(0);
    } catch (error) { clearTimeout(timeout); console.error(error); app.exit(1); }
  });
});
if (process.argv[2]) require(path.resolve(process.argv[2], 'Contents/Resources/app.asar/electron/main.cjs'));
else require('../electron/main.cjs');
