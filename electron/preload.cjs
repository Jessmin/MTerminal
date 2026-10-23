const { contextBridge, ipcRenderer, webUtils } = require('electron');
const invoke = async (channel, ...args) => {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};
const subscribe = (channel, fn) => {
  const listener = (_event, value) => fn(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld('mterminal', {
  info: () => invoke('app:info'),
  hosts: () => invoke('hosts:list'),
  saveHost: input => invoke('hosts:save', input),
  removeHost: id => invoke('hosts:remove', id),
  forgetSecret: id => invoke('hosts:forget', id),
  startSession: input => invoke('session:start', input),
  closeSession: id => invoke('session:close', id),
  activateSession: id => invoke('session:activate', id),
  resourceSample: id => invoke('resources:sample', id),
  write: (id, data) => ipcRenderer.send('session:write', id, data),
  resize: (id, cols, rows) => ipcRenderer.send('session:resize', id, cols, rows),
  ack: (id, amount) => ipcRenderer.send('session:ack', id, amount),
  onData: fn => subscribe('session:data', fn),
  onState: fn => subscribe('session:state', fn),
  onCwd: fn => subscribe('session:cwd', fn),
  onVerify: fn => subscribe('host:verify', fn),
  onTrustResolved: fn => subscribe('host:resolved', fn),
  onTransfer: fn => subscribe('transfer:update', fn),
  onNotice: fn => subscribe('notice', fn),
  onHostsChanged: fn => subscribe('hosts:changed', fn),
  trust: (id, decision) => invoke('host:trust', id, decision),
  listFiles: input => invoke('files:list', input),
  mutateFile: input => invoke('files:mutate', input),
  readText: input => invoke('files:read', input),
  writeText: input => invoke('files:write', input),
  transfer: input => invoke('transfer:start', input),
  cancelTransfer: id => invoke('transfer:cancel', id),
  chooseKey: () => invoke('dialog:key'),
  chooseUpload: () => invoke('dialog:upload'),
  chooseDirectory: () => invoke('dialog:directory'),
  clipboardRead: () => invoke('clipboard:read'),
  clipboardWrite: text => invoke('clipboard:write', text),
  openExternal: url => invoke('external:open', url),
  filePath: file => webUtils.getPathForFile(file),
});
