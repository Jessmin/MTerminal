import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRightLeft, ArrowUpFromLine, Check, ChevronDown, ChevronRight, CircleHelp, Code2, Command, FolderClosed, FolderOpen, HardDrive, KeyRound, LoaderCircle, MoreHorizontal, PanelBottom, Plus, Search, Server, Settings2, ShieldCheck, TerminalSquare, Trash2, Wifi, X, Pencil, Cable } from 'lucide-react';
import { api, message, size, type Host, type Session, type Verification, type Transfer, type AppInfo, type Entry, type EditorFile } from './types';
import { TerminalPane } from './TerminalPane';
import { FilePane } from './FilePane';
import { ResourceMonitor } from './ResourceMonitor';
import { CredentialDialog, EditorDialog, HostDialog, Modal, TextPrompt, TrustDialog } from './Dialogs';

export default function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState('');
  const [query, setQuery] = useState('');
  const [editingHost, setEditingHost] = useState<Partial<Host> | null>(null);
  const [credentials, setCredentials] = useState<Host | null>(null);
  const [verify, setVerify] = useState<Verification[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [showTransfers, setShowTransfers] = useState(false);
  const [showFiles, setShowFiles] = useState(true);
  const [fileHeight, setFileHeight] = useState(370);
  const [fileLocation, setFileLocation] = useState({ sessionId: '', directory: '' });
  const [fileSelection, setFileSelection] = useState<{ sessionId: string; entries: Entry[] }>({ sessionId: '', entries: [] });
  const [refresh, setRefresh] = useState(0);
  const [editor, setEditor] = useState<EditorFile | null>(null);
  const [notice, setNotice] = useState('');
  const [hostMenu, setHostMenu] = useState<string | null>(null);
  const [deleteHost, setDeleteHost] = useState<Host | null>(null);
  const [closing, setClosing] = useState<Session | null>(null);
  const [help, setHelp] = useState(false);
  const tablist = useRef<HTMLDivElement>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((text: string) => {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(''), 6500);
  }, []);
  const reloadHosts = useCallback(async () => setHosts(await api.hosts()), []);
  const local = useCallback((cwd?: string) => {
    const id = crypto.randomUUID();
    setSessions(current => [...current, { id, type: 'local', label: '本地终端', cwd, status: 'connecting' }]);
    setActiveId(id);
  }, []);
  useEffect(() => {
    if (!api) { setNotice('请在 MTerminal 桌面应用中打开。'); return; }
    const dispose = [
      api.onState(event => {
        setSessions(current => current.map(session => session.id === event.id ? { ...session, status: event.status, detail: event.detail, secret: undefined } : session));
        if (event.status === 'ready') void reloadHosts().catch(() => {});
      }),
      api.onCwd(event => setSessions(current => current.map(session => session.id === event.id ? { ...session, cwd: event.directory, cwdRevision: event.revision } : session))),
      api.onVerify(request => setVerify(current => [...current, request])),
      api.onTrustResolved(event => setVerify(current => current.filter(item => item.challengeId !== event.challengeId))),
      api.onTransfer(task => {
        setTransfers(current => {
          const next = current.some(item => item.id === task.id) ? current.map(item => item.id === task.id ? task : item) : [...current, task];
          return next.slice(-100);
        });
        if (task.status === 'done') setRefresh(value => value + 1);
      }),
      api.onNotice(event => notify(event.message)),
      api.onHostsChanged(() => { void reloadHosts().catch(error => notify(message(error))); }),
    ];
    Promise.all([api.info(), api.hosts()]).then(([information, saved]) => {
      setInfo(information); setHosts(saved); local(information.home);
    }).catch(error => notify(message(error)));
    return () => { dispose.forEach(fn => fn()); if (noticeTimer.current) clearTimeout(noticeTimer.current); };
  }, []);
  const active = sessions.find(session => session.id === activeId);
  useEffect(() => { if (api) void api.activateSession(activeId || null).catch(error => notify(message(error))); }, [activeId]);
  const fileDirectory = fileLocation.sessionId === activeId ? fileLocation.directory : '';
  const selectedFiles = fileSelection.sessionId === activeId ? fileSelection.entries : [];
  const activeHost = hosts.find(host => host.id === active?.hostId);
  const remoteOnline = active?.type === 'ssh' && active.status === 'ready';
  const running = transfers.filter(task => ['running', 'queued'].includes(task.status));
  const connect = (host: Host, secret = '', saveSecret = false, useSavedSecret = false) => {
    const id = crypto.randomUUID();
    setSessions(current => [...current, { id, type: 'ssh', hostId: host.id, label: host.name, secret, saveSecret, useSavedSecret, status: 'connecting' }]);
    setActiveId(id); setCredentials(null);
  };
  const close = async (session: Session) => {
    await api.closeSession(session.id);
    const remaining = sessions.filter(item => item.id !== session.id);
    setSessions(remaining);
    if (activeId === session.id) setActiveId(remaining[Math.max(0, sessions.indexOf(session) - 1)]?.id || remaining[0]?.id || '');
    setClosing(null);
  };
  const requestClose = (session: Session) => {
    if (session.status === 'ready' || running.some(task => task.sessionId === session.id)) setClosing(session);
    else void close(session).catch(error => notify(message(error)));
  };
  const retry = () => {
    if (!active) return;
    if (active.type === 'local') local(active?.type === 'local' ? active.cwd : info?.home);
    else if (activeHost) setCredentials(activeHost);
  };
  const transfer = async (direction: 'upload' | 'download', sources?: string[], targetDirectory?: string) => {
    if (!remoteOnline || !active) { notify('请先打开一个 SSH 连接'); return; }
    try {
      const list = sources || (direction === 'upload' ? await api.chooseUpload() : selectedFiles.map(entry => fileDirectory.replace(/\/$/, '') + '/' + entry.name));
      if (!list.length) return;
      const directory = targetDirectory || (direction === 'upload' ? fileDirectory : await api.chooseDirectory());
      if (!directory && direction === 'download') return;
      if (!directory) throw new Error('请先打开目标文件夹');
      const ids = await api.transfer({ direction, sessionId: active.id, sources: list, directory });
      if (ids.length) { setShowTransfers(true); notify(`已加入传输队列 · ${ids.length} 个文件`); }
    } catch (error) { notify(message(error)); }
  };
  const actionRef = useRef({ local, active, requestClose, setEditingHost });
  actionRef.current = { local, active, requestClose, setEditingHost };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return;
      const mac = navigator.platform.toLowerCase().includes('mac');
      if (mac ? !event.metaKey : !(event.ctrlKey && event.shiftKey)) return;
      const key = event.key.toLowerCase();
      if (key === 't') { event.preventDefault(); actionRef.current.local(); }
      if (key === 'n') { event.preventDefault(); actionRef.current.setEditingHost({}); }
      if (key === 'w' && actionRef.current.active) { event.preventDefault(); actionRef.current.requestClose(actionRef.current.active); }
      if (key === 'j') { event.preventDefault(); setShowFiles(current => !current); }
      if (/^Digit[1-9]$/.test(event.code)) {
        event.preventDefault();
        const item = tablist.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[Number(event.code.slice(-1)) - 1];
        item?.click();
      }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);
  const filteredHosts = hosts.filter(host => `${host.name} ${host.hostname} ${host.group} ${host.username}`.toLowerCase().includes(query.toLowerCase()));
  const groups = [...new Set(filteredHosts.map(host => host.group))];
  const errorSession = useCallback((id: string, detail: string) => setSessions(current => current.map(session => session.id === id ? { ...session, status: 'error', detail } : session)), []);
  const changeFileHeight = (event: React.PointerEvent) => {
    const start = event.clientY, height = fileHeight;
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => setFileHeight(Math.max(210, Math.min(window.innerHeight - 300, height + start - moveEvent.clientY)));
    const up = () => { element.removeEventListener('pointermove', move as EventListener); element.removeEventListener('pointerup', up); };
    element.addEventListener('pointermove', move as EventListener); element.addEventListener('pointerup', up, { once: true });
  };
  const mac = info?.platform === 'darwin' || (!info && navigator.platform.toLowerCase().includes('mac'));
  const shortcut = mac ? '⌘ ' : 'Ctrl+Shift+';
  return <div className={`app-shell ${mac ? 'mac' : 'windows'}`} onClick={() => hostMenu && setHostMenu(null)}>
    <header className="titlebar"><div className="wordmark"><span className="brand-mark"><Command size={17} /></span>MTerminal<span className="version-badge">PREVIEW</span></div><div className="titlebar-middle"><span className="live-dot" />本地优先，加密连接</div><div className="titlebar-actions"><button className="icon-button" title="使用帮助与快捷键" onClick={() => setHelp(true)}><CircleHelp size={17} /></button><span className="build-version">v{info?.version || '0.1.0'}</span></div></header>
    <div className="app-body">
      <aside className="sidebar"><div className="sidebar-heading"><span>工作空间</span><span className="tiny-label">WORKSPACE</span></div>
        <button className="sidebar-local" onClick={() => local(active?.type === 'local' ? active.cwd : info?.home)}><span className="local-icon"><TerminalSquare size={18} /></span><span><strong>本地终端</strong><small>{info?.shellLabel || 'Shell'} · {mac ? '这台 Mac' : '这台电脑'}</small></span><Plus size={15} /></button>
        <div className="sidebar-section-title"><span>SSH 主机 <b>{hosts.length.toString().padStart(2, '0')}</b></span><button className="icon-button" title="添加 SSH 主机" onClick={() => setEditingHost({})}><Plus size={15} /></button></div>
        <div className="host-search"><Search size={14} /><input placeholder="搜索主机…" aria-label="搜索主机" value={query} onChange={event => setQuery(event.target.value)} /><span>⌕</span></div>
        <div className="host-list">{groups.map(group => <div className="host-group" key={group}><div className="group-label"><ChevronDown size={12} /><FolderClosed size={12} /><span>{group}</span><small>{filteredHosts.filter(host => host.group === group).length}</small></div>{filteredHosts.filter(host => host.group === group).map(host => {
          const ready = sessions.some(session => session.hostId === host.id && session.status === 'ready');
          return <div className={`host-item ${activeHost?.id === host.id ? 'active' : ''}`} key={host.id}>
            <button className="host-main" onClick={() => setCredentials(host)} title={`连接 ${host.username}@${host.hostname}:${host.port}`}><span className={`host-symbol ${ready ? 'connected' : ''}`}><Server size={15} /></span><span className="host-label"><strong>{host.name}</strong><small>{host.username}@{host.hostname}</small></span>{ready && <span className="live-dot" />}</button>
            <button className="icon-button host-more" aria-label={`管理 ${host.name}`} onClick={event => { event.stopPropagation(); setHostMenu(hostMenu === host.id ? null : host.id); }}><MoreHorizontal size={15} /></button>
            {hostMenu === host.id && <div className="host-context" onClick={event => event.stopPropagation()}><button onClick={() => { setCredentials(host); setHostMenu(null); }}><Cable size={14} />连接主机</button><button onClick={() => { setEditingHost(host); setHostMenu(null); }}><Pencil size={14} />编辑资料</button>{host.hasSecret && <button onClick={() => void api.forgetSecret(host.id).then(reloadHosts).then(() => setHostMenu(null)).catch(error => notify(message(error)))}><KeyRound size={14} />清除已存凭据</button>}<button className="danger-text" onClick={() => { setDeleteHost(host); setHostMenu(null); }}><Trash2 size={14} />删除主机</button></div>}
          </div>;
        })}</div>)}
        {!filteredHosts.length && <div className="hosts-empty"><Server size={25} /><p>{query ? '没有匹配的主机' : '你的服务器，从这里开始'}</p>{!query && <button className="text-button" onClick={() => setEditingHost({})}><Plus size={13} />添加第一台主机</button>}</div>}
        </div>
        <ResourceMonitor session={active} hostName={activeHost?.name} />
        <div className="sidebar-bottom"><div className="local-only"><ShieldCheck size={15} /><div><strong>资料保存在本机</strong><span>凭据可使用系统加密存储</span></div></div><button className="sidebar-footnote" onClick={() => setHelp(true)}><Settings2 size={14} />快捷键与使用说明<ChevronRight size={13} /></button></div>
      </aside>
      <main className="workspace">
        <div className="workspace-heading"><div><span className="eyebrow">YOUR COMMAND CENTER</span><h1>终端工作台 <span>{sessions.filter(session => session.status === 'ready').length} 个活跃会话</span></h1></div><div className="heading-actions"><button className="button" onClick={() => local(active?.type === 'local' ? active.cwd : info?.home)}><TerminalSquare size={15} />本地终端</button><button className="button primary" onClick={() => setEditingHost({})}><Plus size={16} />新建 SSH</button></div></div>
        <section className="terminal-workspace" aria-label="终端工作区"><div className="tab-strip"><div className="tabs" role="tablist" ref={tablist}>{sessions.map(session => <div className={`tab-wrapper ${activeId === session.id ? 'active' : ''}`} key={session.id}><button role="tab" aria-selected={activeId === session.id} className="session-tab" onClick={() => setActiveId(session.id)}>{session.type === 'ssh' ? <Server size={13} /> : <TerminalSquare size={13} />}<span>{session.label}</span><span className={`session-dot ${session.status}`} /></button><button className="tab-close" aria-label={`关闭 ${session.label}`} onClick={() => requestClose(session)}><X size={12} /></button></div>)}</div><button className="new-tab icon-button" title={`新建本地终端 ${shortcut}T`} onClick={() => local()}><Plus size={16} /></button><div className="tab-strip-right"><button className={`icon-button ${showFiles ? 'is-active' : ''}`} title={`切换文件面板 ${shortcut}J`} onClick={() => setShowFiles(!showFiles)}><PanelBottom size={16} /></button></div></div>
          <div className="terminal-toolbar"><div><span className={`connection-state ${active?.status || 'exited'}`} />{active ? active.type === 'ssh' ? `${activeHost?.username || ''}@${activeHost?.hostname || active.label}` : info?.shell || '/bin/zsh' : '没有打开的会话'}{active?.status === 'connecting' && <span className="muted">正在连接…</span>}</div><span><ShieldCheck size={12} />{active?.type === 'ssh' ? 'SSH 加密会话' : 'LOCAL SHELL'}<span className="toolbar-separator">|</span><span>UTF-8</span></span></div>
          <div className="terminal-stage">{sessions.map(session => <TerminalPane key={session.id} session={session} active={activeId === session.id} onFailure={errorSession} />)}
            {!sessions.length && <div className="terminal-welcome"><span className="welcome-logo"><TerminalSquare size={32} /></span><h2>从一行命令开始。</h2><p>本地 Shell、远程主机和文件，放在同一个工作空间。</p><div><button className="button primary" onClick={() => local()}><Plus size={15} />打开本地终端</button><button className="button" onClick={() => setEditingHost({})}>连接 SSH 主机</button></div><small>{shortcut}T 新终端 <span>·</span> {shortcut}N 新主机</small></div>}
            {active && ['error', 'exited'].includes(active.status) && <div className="session-ended"><span className={active.status === 'error' ? 'danger-text' : ''}>{active.status === 'error' ? '连接失败' : '会话已结束'}</span><span>{active.detail}</span><button className="text-button" onClick={retry}>重新打开<ChevronRight size={13} /></button></div>}
          </div>
        </section>
        {showFiles && <><div className="panel-resizer" onPointerDown={changeFileHeight} role="separator" aria-label="拖动调整文件面板高度"><span /></div><section className="file-workspace" style={{ height: fileHeight }}><div className="files-heading"><div><FolderOpen size={15} /><strong>文件管理</strong><span className="subtle-pill">{active?.type === 'ssh' ? 'SFTP' : 'LOCAL'}</span><span className="files-context-label">{active?.label || '无活跃终端'}</span></div><div>{active?.type === 'ssh' && <><button className="small-text-button" disabled={!remoteOnline} onClick={() => void transfer('upload')}><ArrowUpFromLine size={13} />上传文件</button><span className="tool-divider" /><button className="small-text-button" disabled={!remoteOnline || !selectedFiles.length} onClick={() => void transfer('download')}><ArrowDownToLine size={13} />下载所选</button></>}<button className="icon-button" title="收起文件面板" onClick={() => setShowFiles(false)}><ChevronDown size={15} /></button></div></div><div className="file-panes">{info && active ?
          <FilePane key={active.id} side={active.type === 'ssh' ? 'remote' : 'local'} home={info.home} sessionId={active.id} online={active.status === 'ready'} hostName={activeHost?.name} terminalDirectory={active.cwd} refresh={refresh} selection={selectedFiles} onSelection={entries => setFileSelection({ sessionId: active.id, entries })} onDirectory={directory => setFileLocation({ sessionId: active.id, directory })} onEdit={setEditor} onTransfer={transfer} />
          : <div className="file-context-empty"><FolderOpen size={28} /><strong>文件随终端一起工作</strong><span>打开一个终端会话，即可查看对应目录</span></div>}
        </div></section></>}
        <section className={`transfer-panel ${showTransfers ? 'expanded' : ''}`}><button className="transfer-summary" onClick={() => setShowTransfers(!showTransfers)}><ArrowRightLeft size={13} /><strong>传输队列</strong><span className={running.length ? 'transfer-count busy' : 'transfer-count'}>{running.length ? `${running.length} 进行中` : transfers.length ? `${transfers.filter(task => task.status === 'done').length} 已完成` : '暂无传输'}</span><span className="spacer" />{running.length > 0 && <LoaderCircle size={12} className="spin" />}{showTransfers ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button>
          {showTransfers && <div className="transfer-list">{!transfers.length ? <div className="transfer-empty">在 SSH 文件面板上传或下载，也可以拖入本地文件。</div> : [...transfers].reverse().map(task => <div className={`transfer-row ${task.status}`} key={task.id}><span className="transfer-icon">{task.status === 'done' ? <Check size={15} /> : task.direction === 'upload' ? <ArrowUpFromLine size={15} /> : <ArrowDownToLine size={15} />}</span><div className="transfer-name"><strong title={`${task.source} → ${task.target}`}>{task.name}</strong><span>{task.error || `${size(task.bytes)} / ${size(task.total)}`}</span></div><div className="progress-track"><span style={{ width: `${task.status === 'done' ? 100 : task.total ? Math.min(100, task.bytes / task.total * 100) : 0}%` }} /></div><span className="transfer-status">{{ queued: '等待中', running: '传输中', done: '已完成', error: '失败', cancelled: '已取消' }[task.status]}</span>{['queued', 'running'].includes(task.status) ? <button className="icon-button" title="取消传输" onClick={() => void api.cancelTransfer(task.id).catch(error => notify(message(error)))}><X size={13} /></button> : <span className="transfer-end" />}</div>)}</div>}
        </section>
      </main>
    </div>
    <footer className="app-status"><span><span className="live-dot" />MTerminal 就绪<span className="status-divider" />{mac ? 'macOS' : info?.platform === 'win32' ? 'Windows' : info?.platform} · 本机工作空间</span><span>{mac ? <Command size={11} /> : 'Ctrl+Shift+'}T 新终端 <span className="status-divider" />{mac ? <Command size={11} /> : 'Ctrl+Shift+'}J 文件面板 <span className="status-divider" /><ShieldCheck size={12} />本地存储</span></footer>
    {notice && <div className="toast" role="status"><span>{notice}</span><button className="icon-button" onClick={() => setNotice('')} aria-label="关闭通知"><X size={14} /></button></div>}
    {editingHost && <HostDialog host={editingHost} onClose={() => setEditingHost(null)} onSaved={(host, open) => { void reloadHosts(); setEditingHost(null); if (open) setCredentials(host); }} />}
    {credentials && <CredentialDialog host={credentials} encrypted={!!info?.encryptedStorage} onClose={() => setCredentials(null)} onConnect={(secret, save, useSaved) => connect(credentials, secret, save, useSaved)} />}
    {verify[0] && <TrustDialog request={verify[0]} onDecision={decision => void api.trust(verify[0].challengeId, decision).catch(error => notify(message(error)))} />}
    {editor && <EditorDialog file={editor} onClose={() => setEditor(null)} onSaved={() => setRefresh(value => value + 1)} />}
    {deleteHost && <TextPrompt title="删除主机资料" description={`删除“${deleteHost.name}”的本地连接资料和已存凭据。正在运行的会话会保留。`} danger confirmLabel="删除资料" onClose={() => setDeleteHost(null)} onSubmit={async () => { await api.removeHost(deleteHost.id); await reloadHosts(); }} />}
    {closing && <TextPrompt title="关闭终端会话" description={`关闭“${closing.label}”会终止该终端及其连接。${running.some(task => task.sessionId === closing.id) ? '此连接上的文件传输也将取消。' : '请确认终端里的工作已保存。'}`} confirmLabel="关闭会话" onClose={() => setClosing(null)} onSubmit={() => close(closing)} />}
    {help && <Modal title="一个专注的终端工作空间" subtitle="MTerminal 0.1 · 本地终端 / SSH / SFTP" onClose={() => setHelp(false)}><div className="form-body help-content"><p>文件管理只显示当前激活的终端；在终端中切换目录，文件列表会自动跳转并刷新。双击目录进入，双击 UTF-8 文本文件编辑；单个文件最大 1 MiB。</p><div className="shortcut-grid">{[[shortcut + 'T', '新建本地终端'], [shortcut + 'N', '添加 SSH 主机'], [shortcut + 'W', '关闭当前会话'], [shortcut + 'J', '切换文件面板'], [shortcut + '1–9', '切换终端标签'], [shortcut + 'K', '清空终端显示'], [mac ? '⌘ S' : 'Ctrl+S', '保存编辑文件']].map(([key, label]) => <div key={key}><span>{label}</span><kbd>{key}</kbd></div>)}</div><p className="hint">支持密码和私钥认证、文件上传下载与取消、文件重命名、新建文件夹。远程文件删除为永久删除，远程目录仅支持删除空目录。文件夹传输可先打包后上传。</p><footer className="modal-footer"><span className="hint"><ShieldCheck size={13} />主机资料保存在本机</span><button className="button primary" onClick={() => setHelp(false)}>开始使用</button></footer></div></Modal>}
  </div>;
}
