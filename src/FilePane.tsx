import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, ArrowUpRight, Check, ChevronRight, File, FileCode2, FilePlus2, Folder, FolderOpen, FolderPlus, HardDrive, LoaderCircle, Pencil, RefreshCw, Search, Server, Trash2, Eye, EyeOff, Upload, Download, AlertCircle, Link2 } from 'lucide-react';
import { api, join, parent, size, message, type Entry, type Side, type EditorFile } from './types';
import { TextPrompt } from './Dialogs';

type Prompt = { title: string; initial?: string; description?: string; danger?: boolean; confirmLabel?: string; run: (value: string) => Promise<void> };
type Props = {
  side: Side; home: string; sessionId: string; online: boolean; hostName?: string; initialDirectory?: string; terminalDirectory?: string;
  refresh: number; selection: Entry[];
  onSelection: (entries: Entry[]) => void;
  onDirectory: (directory: string) => void;
  onEdit: (file: EditorFile) => void;
  onTransfer: (direction: 'upload' | 'download', sources?: string[], directory?: string) => Promise<void>;
};
export function FilePane(props: Props) {
  const { side, sessionId, home, online, refresh, selection } = props;
  const [directory, setDirectory] = useState('');
  const [pathInput, setPathInput] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [hidden, setHidden] = useState(false);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [dragging, setDragging] = useState(false);
  const request = useRef(0);
  const loading = useRef(false);
  const latest = useRef(props); latest.current = props;
  const dir = useRef(directory); dir.current = directory;
  const remote = side === 'remote';
  const available = online;
  const load = useCallback(async (target: string, background = false) => {
    const version = ++request.current;
    loading.current = true;
    if (!background) setBusy(true);
    try {
      const result = await api.listFiles({ side, sessionId, directory: target });
      if (version !== request.current) return;
      const changed = dir.current !== result.directory;
      dir.current = result.directory;
      setDirectory(result.directory); setEntries(result.entries); setError('');
      if (changed || !background) setPathInput(result.directory);
      if (changed) { setQuery(''); latest.current.onSelection([]); }
      else {
        const current = latest.current.selection;
        const retained = current.map(entry => result.entries.find(item => item.name === entry.name)).filter((entry): entry is Entry => !!entry);
        if (JSON.stringify(current) !== JSON.stringify(retained)) latest.current.onSelection(retained);
      }
      if (changed) latest.current.onDirectory(result.directory);
    } catch (error) { if (version === request.current) setError(message(error)); }
    finally { if (version === request.current) { loading.current = false; setBusy(false); } }
  }, [side, sessionId]);
  useEffect(() => {
    setEntries([]); setDirectory(''); dir.current = ''; setPathInput(''); setError('');
    latest.current.onSelection([]); latest.current.onDirectory('');
    if (available) void load(latest.current.terminalDirectory || latest.current.initialDirectory || (remote ? '.' : home));
    return () => { request.current++; };
  }, [load, available, home, remote]);
  useEffect(() => {
    if (available && props.terminalDirectory && props.terminalDirectory !== dir.current) void load(props.terminalDirectory);
  }, [available, props.terminalDirectory, load]);
  useEffect(() => { if (refresh && available && dir.current) void load(dir.current); }, [refresh]);
  useEffect(() => {
    if (!available) return;
    const timer = setInterval(() => { if (!loading.current && dir.current) void load(dir.current, true); }, 1500);
    return () => clearInterval(timer);
  }, [available, load]);
  const visible = entries.filter(entry => (hidden || !entry.name.startsWith('.')) && entry.name.toLowerCase().includes(query.toLowerCase()));
  const selected = new Set(selection.map(entry => entry.name));
  const choose = (entry: Entry, additive = false) => {
    props.onSelection(additive ? selected.has(entry.name) ? selection.filter(item => item.name !== entry.name) : [...selection, entry] : [entry]);
  };
  const open = async (entry: Entry) => {
    if (entry.directory) { void load(join(directory, entry.name, side)); return; }
    try {
      const filename = join(directory, entry.name, side);
      const result = await api.readText({ side, sessionId, filename });
      props.onEdit({ side, sessionId, filename, ...result });
    } catch (error) { setError(message(error)); }
  };
  const mutate = async (action: string, name: string, nextName?: string) => {
    await api.mutateFile({ side, sessionId, directory, action, name, nextName });
    await load(directory);
  };
  const newFolder = () => setPrompt({ title: remote ? '新建远程文件夹' : '新建文件夹', initial: '新建文件夹', run: name => mutate('mkdir', name) });
  const newFile = () => setPrompt({ title: remote ? '新建远程文件' : '新建文件', initial: 'untitled.txt', run: async name => {
    await mutate('touch', name);
    const filename = join(directory, name, side);
    props.onEdit({ side, sessionId, filename, ...await api.readText({ side, sessionId, filename }) });
  } });
  const rename = () => selection.length === 1 && setPrompt({ title: '重命名', initial: selection[0].name, run: value => mutate('rename', selection[0].name, value) });
  const remove = () => selection.length && setPrompt({
    title: remote ? '删除远程文件' : '移到废纸篓', danger: true,
    description: `${remote ? '永久删除' : '移到废纸篓'} ${selection.length} 项：${selection.map(entry => entry.name).join('、')}。${remote ? '远程目录仅支持删除空目录。' : '可以从系统废纸篓恢复。'}`,
    confirmLabel: remote ? '永久删除' : '移到废纸篓',
    run: async () => {
      const failures: string[] = [];
      for (const entry of selection) {
        try { await api.mutateFile({ side, sessionId, directory, action: 'delete', name: entry.name }); }
        catch (error) { failures.push(`${entry.name}: ${message(error)}`); }
      }
      await load(directory);
      if (failures.length) throw new Error(failures.join('\n'));
    },
  });
  return <section className={`file-pane ${dragging ? 'drop-target' : ''}`} aria-label={remote ? '远程文件' : '本地文件'}
    onDragOver={event => { event.preventDefault(); if (available) setDragging(true); }}
    onDragLeave={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false); }}
    onDrop={event => {
      event.preventDefault(); setDragging(false);
      if (!available) return;
      try {
        const raw = event.dataTransfer.getData('application/x-mterminal');
        if (raw) {
          const payload = JSON.parse(raw);
          if (payload.side !== side) void props.onTransfer(remote ? 'upload' : 'download', payload.paths, directory);
        } else if (remote) {
          const paths = [...event.dataTransfer.files].map(file => api.filePath(file)).filter(Boolean);
          if (paths.length) void props.onTransfer('upload', paths, directory);
        }
      } catch (error) { setError(message(error)); }
    }}>
    <div className="file-pane-title"><div>{remote ? <Server size={14} /> : <HardDrive size={14} />}<strong>{remote ? '远程文件' : '本地文件'}</strong><span className="pane-location">{remote ? props.hostName || '等待连接' : '这台电脑'}</span></div><div className="file-tools">
      {!remote && <button className="icon-button" title="选择本地文件夹" onClick={() => void api.chooseDirectory().then(value => { if (value) return load(value); }).catch(error => setError(message(error)))}><FolderOpen size={14} /></button>}
      <button className="icon-button" title={hidden ? '隐藏点文件' : '显示点文件'} disabled={!available} onClick={() => setHidden(!hidden)}>{hidden ? <Eye size={14} /> : <EyeOff size={14} />}</button>
      <span className="file-auto-refresh">自动刷新</span><button className="icon-button" title="刷新文件" disabled={!available || busy} onClick={() => void load(directory || (remote ? '.' : home))}><RefreshCw size={14} className={busy ? 'spin' : ''} /></button>
    </div></div>
    {available ? <>
      <form className="path-bar" onSubmit={event => { event.preventDefault(); void load(pathInput); }}>
        <button type="button" className="icon-button" title="上一级" disabled={!directory || directory === '/'} onClick={() => void load(parent(directory, side))}><ArrowUp size={15} /></button>
        <ChevronRight size={12} className="muted" /><input aria-label={remote ? '远程路径' : '本地路径'} value={pathInput} onChange={event => setPathInput(event.target.value)} placeholder={remote ? '输入远程目录' : '输入本地目录'} spellCheck={false} />
        <button className={`icon-button ${directory === props.terminalDirectory ? 'is-active' : ''}`} type="button" title="回到当前终端目录" disabled={!props.terminalDirectory} onClick={() => props.terminalDirectory && void load(props.terminalDirectory)}><Link2 size={15} /></button>
      </form>
      <div className="file-action-bar"><div className="file-tools"><button className="icon-button" title="新建文件夹" disabled={!directory} onClick={newFolder}><FolderPlus size={15} /></button><button className="icon-button" title="新建文本文件" disabled={!directory} onClick={newFile}><FilePlus2 size={14} /></button><button className="icon-button" title="重命名选中项" disabled={selection.length !== 1} onClick={rename}><Pencil size={14} /></button><button className="icon-button danger-hover" title={remote ? '删除远程选中项' : '选中项移到废纸篓'} disabled={!selection.length} onClick={() => void remove()}><Trash2 size={14} /></button>{remote && <><span className="tool-divider" /><button className="small-text-button" title="下载所选文件" disabled={!selection.length || !online} onClick={() => void props.onTransfer('download', selection.map(entry => join(directory, entry.name, side)))}><Download size={13} />下载</button></>}</div>
        <div className="file-filter"><Search size={12} /><input aria-label={remote ? '筛选远程文件' : '筛选本地文件'} placeholder="筛选文件" value={query} onChange={event => setQuery(event.target.value)} /></div>
      </div>
      {error && <div className="file-error"><AlertCircle size={13} /><span>{error}</span><button className="text-button" onClick={() => setError('')}>关闭</button></div>}
      <div className="file-table-scroll">
        <table className="file-table"><thead><tr><th className="check-cell"><input type="checkbox" aria-label="全选文件" checked={visible.length > 0 && visible.every(entry => selected.has(entry.name))} onChange={event => props.onSelection(event.target.checked ? visible : [])} /></th><th>名称</th><th className="file-size">大小</th><th className="file-date">修改时间</th></tr></thead><tbody>
          {visible.map(entry => <tr key={entry.name} className={selected.has(entry.name) ? 'selected' : ''} tabIndex={0} draggable onDragStart={event => {
            const items = selected.has(entry.name) ? selection : [entry];
            event.dataTransfer.setData('application/x-mterminal', JSON.stringify({ side, paths: items.map(item => join(directory, item.name, side)) }));
            event.dataTransfer.effectAllowed = 'copy';
          }} onClick={event => choose(entry, event.metaKey || event.ctrlKey)} onDoubleClick={() => void open(entry)} onKeyDown={event => {
            if (event.key === 'Enter') { event.preventDefault(); void open(entry); }
            if (event.key === ' ') { event.preventDefault(); choose(entry, true); }
          }}>
            <td className="check-cell"><input type="checkbox" aria-label={`选择 ${entry.name}`} checked={selected.has(entry.name)} onClick={event => event.stopPropagation()} onChange={() => choose(entry, true)} /></td>
            <td><div className="filename">{entry.directory ? <Folder size={15} className="folder-icon" /> : /\.(json|js|ts|py|sh|md|txt|conf|yaml|yml|log|css|html|toml)$/i.test(entry.name) ? <FileCode2 size={15} className="text-file-icon" /> : <File size={15} className="muted" />}<span>{entry.name}</span>{entry.symlink && <Link2 size={11} className="muted" />}</div></td>
            <td className="file-size">{entry.directory ? '—' : size(entry.size)}</td><td className="file-date">{new Date(entry.modified).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })} {new Date(entry.modified).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</td>
          </tr>)}
        </tbody></table>
        {!visible.length && <div className="file-empty">{busy ? <><LoaderCircle size={20} className="spin" /><span>正在读取目录…</span></> : <><FolderOpen size={25} /><span>{query ? '没有匹配的文件' : '文件夹为空'}</span></>}</div>}
      </div>
      <footer className="file-pane-footer"><span>{visible.length} 个项目{selection.length ? ` · 已选 ${selection.length} 项` : ''}</span><span>{selection.length > 0 && <Check size={11} />} {selection.length > 0 ? size(selection.reduce((total, item) => total + (item.directory ? 0 : item.size), 0)) : '双击打开 · 跟随终端目录 · 自动刷新'}</span></footer>
    </> : <div className="remote-empty"><div className="remote-illustration">{remote ? <Server size={27} /> : <HardDrive size={27} />}<span className="connection-dot" /></div><h3>等待当前终端连接</h3><p>终端就绪后，自动显示对应文件</p></div>}
    {dragging && <div className="drop-overlay"><Upload size={27} /><strong>{remote ? '松开以上传到此目录' : '松开以下载到此目录'}</strong></div>}
    {prompt && <TextPrompt title={prompt.title} initial={prompt.initial} description={prompt.description} danger={prompt.danger} confirmLabel={prompt.confirmLabel} onClose={() => setPrompt(null)} onSubmit={prompt.run} />}
  </section>;
}
