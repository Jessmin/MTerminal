import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X, FolderOpen, ShieldCheck, ShieldAlert, LoaderCircle, KeyRound, Save, FileCode2 } from 'lucide-react';
import { api, message, type Host, type Verification, type EditorFile } from './types';

export function Modal({ title, subtitle, children, onClose, wide = false }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = root.current;
    const timer = requestAnimationFrame(() => (element?.querySelector<HTMLElement>('input:not([type=checkbox]), textarea') || element?.querySelector<HTMLElement>('button'))?.focus());
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close.current(); }
      if (event.key === 'Tab') {
        const nodes = [...(element?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]') || [])];
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { cancelAnimationFrame(timer); document.removeEventListener('keydown', key); previous?.focus(); };
  }, []);
  return <div className="modal-backdrop"><div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={root}>
    <header className="modal-header"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" onClick={onClose} aria-label="关闭对话框"><X size={18} /></button></header>
    {children}
  </div></div>;
}

export function HostDialog({ host, onClose, onSaved }: { host: Partial<Host>; onClose: () => void; onSaved: (host: Host, connect: boolean) => void }) {
  const [form, setForm] = useState({ name: '', hostname: '', port: 22, username: 'root', group: '我的主机', auth: 'password', privateKeyPath: '', note: '', ...host } as Host);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const field = (key: keyof Host, value: unknown) => setForm(current => ({ ...current, [key]: value }));
  const save = async (connect: boolean) => {
    setBusy(true); setError('');
    try { onSaved(await api.saveHost(form), connect); } catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  };
  return <Modal title={host.id ? '编辑主机' : '添加 SSH 主机'} subtitle="保存连接资料，凭据在连接时输入。" onClose={onClose}>
    <form onSubmit={event => { event.preventDefault(); void save(true); }} className="form-body">
      <label>连接名称<input autoFocus value={form.name} onChange={e => field('name', e.target.value)} placeholder="例如：开发服务器" /></label>
      <div className="form-row host-port"><label>主机地址<input required value={form.hostname} onChange={e => field('hostname', e.target.value)} placeholder="IP 地址或域名" /></label><label>端口<input required type="number" min="1" max="65535" value={form.port} onChange={e => field('port', Number(e.target.value))} /></label></div>
      <div className="form-row"><label>用户名<input required value={form.username} onChange={e => field('username', e.target.value)} /></label><label>分组<input value={form.group} onChange={e => field('group', e.target.value)} /></label></div>
      <label>认证方式<div className="segmented"><button type="button" className={form.auth === 'password' ? 'selected' : ''} onClick={() => field('auth', 'password')}>密码</button><button type="button" className={form.auth === 'key' ? 'selected' : ''} onClick={() => field('auth', 'key')}>SSH 私钥</button></div></label>
      {form.auth === 'key' && <label>私钥文件<div className="input-action"><input required value={form.privateKeyPath} onChange={e => field('privateKeyPath', e.target.value)} placeholder="~/.ssh/id_ed25519" /><button type="button" className="icon-button" aria-label="选择私钥" onClick={() => void api.chooseKey().then(value => value && field('privateKeyPath', value)).catch(error => setError(message(error)))}><FolderOpen size={17} /></button></div></label>}
      <label>备注<input value={form.note} onChange={e => field('note', e.target.value)} placeholder="可选" /></label>
      {error && <div className="error-box">{error}</div>}
      <footer className="modal-footer"><button type="button" className="button" onClick={onClose}>取消</button><span className="spacer" /><button type="button" className="button" disabled={busy} onClick={() => void save(false)}>保存</button><button className="button primary" disabled={busy}>{busy ? <LoaderCircle size={15} className="spin" /> : <KeyRound size={15} />}保存并连接</button></footer>
    </form>
  </Modal>;
}

export function CredentialDialog({ host, encrypted, onClose, onConnect }: { host: Host; encrypted: boolean; onClose: () => void; onConnect: (secret: string, save: boolean, useSaved: boolean) => void }) {
  const [secret, setSecret] = useState('');
  const [save, setSave] = useState(false);
  const [useSaved, setUseSaved] = useState(!!host.hasSecret);
  return <Modal title={`连接 ${host.name}`} subtitle={`${host.username}@${host.hostname}:${host.port}`} onClose={onClose}>
    <form className="form-body" onSubmit={event => { event.preventDefault(); onConnect(useSaved ? '' : secret, save && !useSaved, useSaved); }}>
      {useSaved ? <div className="saved-credential"><ShieldCheck size={22} /><div><strong>使用已加密保存的凭据</strong><p>由当前系统账户解密。</p></div><button className="text-button" type="button" onClick={() => setUseSaved(false)}>重新输入</button></div> : <>
        <label>{host.auth === 'key' ? '私钥口令' : 'SSH 密码'}<input type="password" autoFocus value={secret} onChange={event => setSecret(event.target.value)} placeholder={host.auth === 'key' ? '未加密的私钥可留空' : '输入连接密码'} autoComplete="off" /></label>
        <label className="checkbox-label"><input type="checkbox" checked={save} disabled={!encrypted} onChange={event => setSave(event.target.checked)} />使用系统加密存储保存凭据</label>
      </>}
      {host.auth === 'key' && <div className="hint mono key-path">{host.privateKeyPath}</div>}
      <footer className="modal-footer"><button className="button" type="button" onClick={onClose}>取消</button><button className="button primary" type="submit">连接主机</button></footer>
    </form>
  </Modal>;
}

export function TrustDialog({ request, onDecision }: { request: Verification; onDecision: (decision: 'save' | 'once' | 'reject') => void }) {
  return <Modal title={request.changed ? '主机指纹发生变化' : '确认 SSH 主机身份'} subtitle={`${request.hostname}:${request.port}`} onClose={() => onDecision('reject')}>
    <div className="form-body"><div className={`trust-icon ${request.changed ? 'warning' : ''}`}>{request.changed ? <ShieldAlert size={30} /> : <ShieldCheck size={30} />}</div>
      <p className="dialog-copy">{request.changed ? '当前指纹与之前保存的记录不同。请确认服务器是否重装或更换密钥，再决定是否继续。' : '这是首次连接此主机。请与服务器提供的指纹核对，确认后保存信任。'}</p>
      <label>当前指纹<code className="fingerprint">{request.fingerprint}</code></label>
      {request.previous && <label>之前保存的指纹<code className="fingerprint muted">{request.previous}</code></label>}
      <footer className="modal-footer"><button className="button" onClick={() => onDecision('reject')}>取消连接</button><span className="spacer" /><button className="button" onClick={() => onDecision('once')}>仅本次继续</button><button className={`button ${request.changed ? 'danger' : 'primary'}`} onClick={() => onDecision('save')}>{request.changed ? '更新指纹并连接' : '信任并连接'}</button></footer>
    </div>
  </Modal>;
}

export function TextPrompt({ title, initial, description, danger, confirmLabel, onClose, onSubmit }: { title: string; initial?: string; description?: string; danger?: boolean; confirmLabel?: string; onClose: () => void; onSubmit: (value: string) => Promise<void> }) {
  const [value, setValue] = useState(initial || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <Modal title={title} onClose={() => !busy && onClose()}><form className="form-body" onSubmit={async event => {
    event.preventDefault(); setBusy(true); setError('');
    try { await onSubmit(value); onClose(); } catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  }}>
    {description && <p className="dialog-copy">{description}</p>}
    {initial !== undefined && <label>名称<input value={value} onChange={event => setValue(event.target.value)} autoFocus required /></label>}
    {error && <div className="error-box">{error}</div>}
    <footer className="modal-footer"><button className="button" type="button" disabled={busy} onClick={onClose}>取消</button><button className={`button ${danger ? 'danger' : 'primary'}`} disabled={busy}>{busy && <LoaderCircle size={14} className="spin" />}{confirmLabel || '确定'}</button></footer>
  </form></Modal>;
}

export function EditorDialog({ file, onClose, onSaved }: { file: EditorFile; onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState(file.text);
  const [original, setOriginal] = useState(file.text);
  const [revision, setRevision] = useState(file.revision);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const dirty = text !== original;
  const save = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try { const result = await api.writeText({ ...file, text, revision }); setRevision(result.revision); setOriginal(text); onSaved(); }
    catch (error) { setError(message(error)); } finally { setBusy(false); }
  };
  return <Modal title={`${dirty ? '● ' : ''}${file.filename.split(/[\\/]/).pop()}`} subtitle={`${file.side === 'remote' ? '远程' : '本地'} · ${file.filename}`} onClose={() => { if (!busy) dirty ? setConfirmClose(true) : onClose(); }} wide>
    <div className="editor-toolbar"><span><FileCode2 size={14} /> UTF-8 <span className="separator">/</span> {text.split('\n').length} 行</span><span>{dirty ? '有未保存的修改' : '已保存'}</span></div>
    <textarea className="text-editor" spellCheck={false} value={text} onChange={event => setText(event.target.value)} onKeyDown={event => {
      if ((event.metaKey || event.ctrlKey) && event.key === 's') { event.preventDefault(); void save(); }
      if (event.key === 'Tab') {
        event.preventDefault(); const node = event.currentTarget; const start = node.selectionStart, end = node.selectionEnd;
        setText(text.slice(0, start) + '  ' + text.slice(end)); requestAnimationFrame(() => { node.selectionStart = node.selectionEnd = start + 2; });
      }
    }} aria-label="文件内容" />
    {error && <div className="error-box editor-error">{error}</div>}
    <footer className="modal-footer editor-footer">{confirmClose ? <><span>放弃未保存的修改？</span><button className="button" onClick={() => setConfirmClose(false)}>继续编辑</button><button className="button danger" onClick={onClose}>放弃修改</button></> : <><span className="hint">{navigator.platform.toLowerCase().includes('mac') ? '⌘ S' : 'Ctrl+S'} 保存</span><span className="spacer" /><button className="button" onClick={() => dirty ? setConfirmClose(true) : onClose()}>关闭</button><button className="button primary" disabled={!dirty || busy} onClick={() => void save()}>{busy ? <LoaderCircle size={15} className="spin" /> : <Save size={15} />}保存修改</button></>}</footer>
  </Modal>;
}
