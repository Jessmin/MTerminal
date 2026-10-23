import { useEffect, useState } from 'react';
import { Activity, ArrowDown, ArrowUp, ChevronDown, Cpu, HardDrive, MemoryStick, Network, Pause, Play } from 'lucide-react';
import { api, message, size, type ResourceSample, type Session } from './types';

const percent = (value: number | null | undefined) => value == null ? '—' : `${value.toFixed(1)}%`;
const rate = (value: number | null | undefined) => value == null ? '—' : `${size(Math.round(value))}/s`;
function uptime(value: number | null) {
  if (value == null) return '';
  const hours = Math.floor(value / 3600), days = Math.floor(hours / 24);
  return days ? `${days} 天 ${hours % 24} 小时` : `${hours} 小时 ${Math.floor(value / 60) % 60} 分钟`;
}
function Meter({ value }: { value?: number | null }) {
  return <div className={`resource-meter ${(value || 0) >= 90 ? 'high' : ''}`} role="progressbar" aria-label="使用率" aria-valuenow={value ?? undefined} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${value ?? 0}%` }} /></div>;
}
export function ResourceMonitor({ session, hostName }: { session?: Session; hostName?: string }) {
  const [sample, setSample] = useState<ResourceSample | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const [error, setError] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(!document.hidden);
  const [selectedInterface, setSelectedInterface] = useState('');
  const id = session?.id, online = session?.status === 'ready';
  useEffect(() => {
    const changed = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', changed);
    return () => document.removeEventListener('visibilitychange', changed);
  }, []);
  useEffect(() => { setSample(null); setHistory([]); setError(''); setSelectedInterface(''); }, [id]);
  useEffect(() => {
    if (!id || !online || paused || collapsed || !visible) return;
    let cancelled = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let failed = false;
      try {
        const next = await api.resourceSample(id);
        if (cancelled) return;
        if (next.sessionId !== id) throw new Error('监控对象已切换');
        setSample(next); setError('');
        if (next.cpuPercent !== null) setHistory(current => [...current.slice(-23), next.cpuPercent!]);
      } catch (error) { if (!cancelled) { failed = true; setError(message(error)); } }
      if (!cancelled) timer = setTimeout(() => void poll(), failed ? 10000 : 3000);
    };
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [id, online, paused, collapsed, visible]);
  const data = sample?.sessionId === id ? sample : null;
  const network = data?.network.find(item => item.name === selectedInterface) || data?.network.find(item => item.name === data.preferredInterface) || data?.network[0];
  const title = session?.type === 'ssh' ? hostName || session.label : '这台 Mac';
  const status = paused ? '已暂停' : !visible ? '窗口已隐藏' : error ? '读取失败' : data ? '自动更新' : '正在采样';
  return <section className={`resource-monitor ${collapsed ? 'collapsed' : ''}`} aria-label="主机资源监控">
    <header className="resource-header"><Activity size={14} /><strong>资源监控</strong><span className="spacer" />
      {!collapsed && <button className={`icon-button ${paused ? 'is-active' : ''}`} title={paused ? '恢复资源监控' : '暂停资源监控'} aria-label={paused ? '恢复资源监控' : '暂停资源监控'} onClick={() => setPaused(value => !value)}>{paused ? <Play size={12} /> : <Pause size={12} />}</button>}
      <button className="icon-button" title={collapsed ? '展开资源监控' : '收起资源监控'} aria-label={collapsed ? '展开资源监控' : '收起资源监控'} aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}><ChevronDown size={14} className={collapsed ? 'resource-chevron-closed' : ''} /></button>
    </header>
    {!collapsed && <>
      <div className="resource-context"><span title={title}>{session ? title : '无活跃终端'}</span><small className={error ? 'danger-text' : ''}>{online ? status : '等待连接'}</small></div>
      {!online ? <div className="resource-waiting">连接终端后，显示对应主机状态</div> : <div className={`resource-body ${error || paused ? 'resource-stale' : ''}`}>
        <div className="resource-row"><div className="resource-label"><Cpu size={12} /><span>CPU</span><strong>{percent(data?.cpuPercent)}</strong></div>
          <svg className="resource-chart" viewBox="0 0 200 22" preserveAspectRatio="none" role="img" aria-label="最近 CPU 使用率趋势"><path d="M0 21.5 H200" className="resource-chart-grid" />{data && history.length > 1 && <polyline points={history.map((value, index) => `${(24 - history.length + index) * 200 / 23},${21 - value * .2}`).join(' ')} />}{data && history.length > 0 && <circle cx="200" cy={21 - history.at(-1)! * .2} r="1.6" fill="#92dab3" />}</svg>
          <small>{data ? data.cpuPercent === null ? '等待第二次采样' : `${data.cores || '—'} 核 · 负载 ${data.load.map(value => value.toFixed(2)).join(' / ') || '—'}` : '正在读取主机状态…'}</small>
        </div>
        <div className="resource-row" title={data?.memory.source === 'macos-estimate' ? 'macOS 已用内存根据空闲、非活跃及推测页估算，含压缩内存；与活动监视器口径可能不同' : 'Linux 已用内存按 MemTotal − MemAvailable 计算；旧内核使用可回收内存估算'}><div className="resource-label"><MemoryStick size={12} /><span>内存</span><strong>{percent(data?.memory.percent)}</strong></div><Meter value={data?.memory.percent} /><small>{data ? `${size(data.memory.used)} / ${size(data.memory.total)}` : '—'}</small></div>
        <div className="resource-row" title={data?.disk?.mount || '系统磁盘'}><div className="resource-label"><HardDrive size={12} /><span>磁盘</span><strong>{percent(data?.disk?.percent)}</strong></div><Meter value={data?.disk?.percent} /><small>{data?.disk ? `可用 ${size(data.disk.available)} / ${size(data.disk.total)}` : data ? '磁盘统计不可用' : '—'}</small></div>
        <div className="resource-row resource-network"><div className="resource-label"><Network size={12} /><span>网络</span><select aria-label="监控网卡" value={network?.name || ''} onChange={event => setSelectedInterface(event.target.value)} disabled={!data?.network.length}>{data?.network.length ? data.network.map(item => <option value={item.name} key={item.name}>{item.name}</option>) : <option value="">—</option>}</select></div><div className="resource-rates"><span title="接收速率"><ArrowDown size={11} /><strong>{rate(network?.receiveRate)}</strong></span><span title="发送速率"><ArrowUp size={11} /><strong>{rate(network?.sendRate)}</strong></span></div>{data && !data.network.length && <small>网卡统计不可用</small>}</div>
      </div>}
      {online && error && <p className="resource-error" role="status" title={error}>{error}<span>{paused ? '恢复监控后重试' : !visible ? '窗口显示后重试' : '10 秒后自动重试'}</span></p>}
      {online && data && <footer className="resource-footer"><span title={data.sampledAt ? new Date(data.sampledAt).toLocaleString('zh-CN') : ''}>运行 {uptime(data.uptime) || '—'}</span><span>{data.platform === 'Darwin' ? 'macOS' : data.platform}</span></footer>}
    </>}
  </section>;
}
