const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell, clipboard, Menu } = require('electron');
const path = require('node:path');
const os = require('node:os');
const { Store } = require('./store.cjs');
const { Sessions } = require('./sessions.cjs');
const { Files } = require('./files.cjs');
const { defaultShell } = require('./platform.cjs');
const { Resources } = require('./resources.cjs');

app.setName('MTerminal');
const { probeOptions, runProbe } = require('./network-probe.cjs');
const probe = probeOptions(process.argv);
if (probe) {
  app.whenReady().then(async () => {
    const metadata = { version: require('../package.json').version, executable: process.execPath, launch: 'packaged-main' };
    const first = await runProbe(probe, { ...metadata, attempt: 1 });
    if (!first.connected) {
      // macOS can suppress the local-network alert if the process exits as soon
      // as the first socket is denied (Apple FB16131937). Allow it time to show.
      await new Promise(resolve => setTimeout(resolve, 15000));
      await runProbe(probe, { ...metadata, attempt: 2, firstError: first.error });
    }
    app.quit();
  }).catch(error => { console.error(error); app.exit(1); });
} else {
let window;
let sessions;
let files;
const developmentURL = process.env.MTERMINAL_DEV_URL;
const single = app.requestSingleInstanceLock();
if (!single) app.quit();
app.on('second-instance', () => { window?.show(); window?.focus(); });

function createWindow() {
  window = new BrowserWindow({
    width: 1440, height: 940, minWidth: 1040, minHeight: 680,
    backgroundColor: '#101417', title: 'MTerminal',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay: process.platform === 'win32' ? { color: '#171d21', symbolColor: '#c7d7df', height: 64 } : undefined,
    autoHideMenuBar: process.platform !== 'darwin',
    icon: path.join(__dirname, '../assets/icon.png'),
    trafficLightPosition: process.platform === 'darwin' ? { x: 18, y: 22 } : undefined, show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      spellcheck: false, backgroundThrottling: false,
    },
  });
  if (process.platform === 'darwin') app.dock?.setIcon(path.join(__dirname, '../assets/icon.png'));
  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  const emit = (channel, payload) => { if (window && !window.isDestroyed()) window.webContents.send(channel, payload); };
  const store = new Store(app.getPath('userData'), safeStorage);
  sessions = new Sessions(store, emit);
  const resources = new Resources(sessions);
  files = new Files(sessions, emit, async names => {
    const result = await dialog.showMessageBox(window, {
      type: 'warning', title: '替换同名文件',
      message: `目标位置已有 ${names.length} 个同名文件，是否替换？`,
      detail: names.slice(0, 8).join('\n') + (names.length > 8 ? '\n…' : ''),
      buttons: ['取消', '替换文件'], defaultId: 0, cancelId: 0,
    });
    return result.response === 1;
  }, filename => shell.trashItem(filename));
  const trusted = event => event.sender === window?.webContents && event.senderFrame === window.webContents.mainFrame;
  const handle = (channel, fn) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (event, ...args) => {
      if (!trusted(event)) return { ok: false, error: '请求来源无效' };
      try { return { ok: true, value: await fn(...args) }; }
      catch (error) { return { ok: false, error: error.message || '操作失败' }; }
    });
  };
  handle('app:info', () => ({
    platform: process.platform, home: os.homedir(), version: require('../package.json').version,
    // Initialize/unlock the OS keychain only when saving or using a credential.
    shell: defaultShell().file, shellLabel: defaultShell().label, encryptedStorage: true,
  }));
  handle('hosts:list', () => store.list());
  handle('hosts:save', input => store.save(input));
  handle('hosts:remove', id => store.remove(id));
  handle('hosts:forget', id => store.forgetSecret(id));
  handle('session:start', input => sessions.start(input));
  handle('session:close', id => sessions.close(id));
  handle('session:activate', id => sessions.activate(id));
  handle('resources:sample', id => resources.read(id));
  handle('host:trust', (id, decision) => sessions.resolveTrust(id, decision));
  handle('files:list', input => files.list(input));
  handle('files:mutate', input => files.mutate(input));
  handle('files:read', input => files.readText(input));
  handle('files:write', input => files.writeText(input));
  handle('transfer:start', input => files.transfer(input));
  handle('transfer:cancel', id => files.cancel(id));
  handle('dialog:key', async () => {
    const result = await dialog.showOpenDialog(window, { title: '选择 SSH 私钥', defaultPath: path.join(os.homedir(), '.ssh'), properties: ['openFile', 'showHiddenFiles'] });
    return result.canceled ? null : result.filePaths[0];
  });
  handle('dialog:upload', async () => {
    const result = await dialog.showOpenDialog(window, { title: '选择上传文件', properties: ['openFile', 'multiSelections', 'showHiddenFiles'] });
    return result.canceled ? [] : result.filePaths;
  });
  handle('dialog:directory', async () => {
    const result = await dialog.showOpenDialog(window, { title: '选择本地文件夹', properties: ['openDirectory', 'showHiddenFiles'] });
    return result.canceled ? null : result.filePaths[0];
  });
  handle('clipboard:read', () => clipboard.readText());
  handle('clipboard:write', text => clipboard.writeText(String(text)));
  handle('external:open', url => {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('仅允许打开 HTTP / HTTPS 链接');
    return shell.openExternal(parsed.href);
  });
  for (const channel of ['session:write', 'session:resize', 'session:ack']) ipcMain.removeAllListeners(channel);
  ipcMain.on('session:write', (event, id, data) => { if (trusted(event)) sessions.write(id, data); });
  ipcMain.on('session:resize', (event, id, cols, rows) => { if (trusted(event)) sessions.resize(id, cols, rows); });
  ipcMain.on('session:ack', (event, id, amount) => { if (trusted(event)) sessions.ack(id, amount); });
  window.on('close', event => {
    if (window.__closing) return;
    const pending = [...files.transfers.values()].some(task => ['queued', 'running'].includes(task.status));
    if (pending) {
      event.preventDefault();
      dialog.showMessageBox(window, { type: 'warning', message: '传输仍在进行，退出将取消传输。', buttons: ['继续传输', '取消传输并退出'], defaultId: 0, cancelId: 0 }).then(result => {
        if (result.response === 1) { window.__closing = true; window.close(); }
      });
    }
  });
  window.on('closed', () => { files.dispose(); sessions.dispose(); window = null; });
  if (developmentURL === 'http://127.0.0.1:5178') window.loadURL(developmentURL);
  else window.loadFile(path.join(__dirname, '../dist/index.html'));
}

app.whenReady().then(() => {
  // Windows terminal control keys must reach xterm (especially Ctrl+C / Ctrl+V).
  // The macOS menu keeps its Command-based native editing accelerators.
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([
    { label: 'MTerminal', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { type: 'separator' }, { role: 'quit' }] },
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '视图', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }, ...(developmentURL ? [{ role: 'toggleDevTools' }] : [])] },
    { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }] },
  ]) : null);
  createWindow();
}).catch(error => { dialog.showErrorBox('MTerminal 无法启动', error.message); app.quit(); });
app.on('window-all-closed', () => app.quit());
}
