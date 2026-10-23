const os = require('node:os');
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { execText } = require('./cwd.cjs');

const MARKER = '__MTERMINAL_RESOURCE_V1__';
const clamp = (value, max) => Math.max(0, Math.min(max, value));
const number = value => Number.isFinite(Number(value)) ? Number(value) : null;
const command = (file, args, timeout = 2500) => new Promise((resolve, reject) => execFile(file, args, {
  timeout, maxBuffer: 65536, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' },
}, (error, output) => error ? reject(error) : resolve(output)));
const section = (name, body) => `printf '\\n${MARKER}${name}\\n'; ${body}`;
function collectionScript(platform) {
  const parts = platform === 'Linux' ? {
    CPU: `awk '/^cpu /{print} /^cpu[0-9]+ /{n++} END{print "cores",n}' /proc/stat`,
    MEMORY: 'cat /proc/meminfo', UPTIME: 'cat /proc/uptime', LOAD: 'cat /proc/loadavg',
    NETWORK: 'cat /proc/net/dev', ROUTE: 'cat /proc/net/route', DISK: 'df -kP /',
  } : platform === 'Darwin' ? {
    CPU: '/usr/bin/top -l 2 -s 1 -n 0', CORES: '/usr/sbin/sysctl -n hw.ncpu',
    MEMORY: '/usr/bin/vm_stat', TOTAL: '/usr/sbin/sysctl -n hw.memsize',
    UPTIME: '/usr/sbin/sysctl -n kern.boottime; date +%s', LOAD: '/usr/sbin/sysctl -n vm.loadavg',
    NETWORK: '/usr/sbin/netstat -ibn', ROUTE: '/sbin/route -n get default',
    DISK: 'if [ -d /System/Volumes/Data ]; then /bin/df -kP /System/Volumes/Data; else /bin/df -kP /; fi',
  } : null;
  if (!parts) throw new Error('当前资源监控支持 macOS 和 Linux 主机');
  return 'LC_ALL=C; export LC_ALL; ' + Object.entries(parts).map(([name, body]) => section(name, body)).join('; ') + `; printf '\\n${MARKER}END\\n'`;
}
function sections(output) {
  const values = {};
  const chunks = output.split(new RegExp(`(?:^|\\r?\\n)${MARKER}([A-Z]+)\\r?\\n`));
  for (let i = 1; i + 1 < chunks.length; i += 2) values[chunks[i]] = chunks[i + 1].trim();
  return values;
}
function memory(total, available, source) {
  if (!(total > 0) || !Number.isFinite(total) || available === null || !Number.isFinite(available)) return null;
  available = clamp(available, total);
  return { total, available, used: total - available, percent: 100 * (total - available) / total, source };
}
function linuxMemory(text) {
  const fields = {};
  for (const match of text.matchAll(/^(\w+):\s+(\d+)\s+kB/gm)) fields[match[1]] = Number(match[2]) * 1024;
  const available = fields.MemAvailable ?? (fields.MemFree === undefined ? null : fields.MemFree + (fields.Buffers || 0) + (fields.Cached || 0) + (fields.SReclaimable || 0) - (fields.Shmem || 0));
  return memory(fields.MemTotal, available, fields.MemAvailable === undefined ? 'linux-estimate' : 'linux-available');
}
function darwinMemory(text, total) {
  const pageSize = Number(/page size of (\d+) bytes/.exec(text)?.[1]);
  const pages = name => number(new RegExp(`^Pages ${name}:\\s+(\\d+)`, 'm').exec(text)?.[1]);
  const free = pages('free'), inactive = pages('inactive'), speculative = pages('speculative');
  if (!(pageSize > 0) || free === null || inactive === null || speculative === null) return null;
  return memory(total, (free + inactive + speculative) * pageSize, 'macos-estimate');
}
function disk(text) {
  for (const line of text.split(/\r?\n/).reverse()) {
    const match = /^\S+\s+(\d+)\s+(\d+)\s+(-?\d+)\s+\d+%\s+(.+)$/.exec(line.trim());
    if (!match) continue;
    const total = Number(match[1]) * 1024, available = clamp(Number(match[3]) * 1024, total);
    if (total > 0 && Number.isFinite(total) && Number.isFinite(available)) return { mount: match[4], total, available, used: total - available, percent: (1 - available / total) * 100 };
  }
  return null;
}
function linuxNetwork(text) {
  const values = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([^:\s]+):\s*(.+)$/.exec(line);
    if (!match || match[1] === 'lo') continue;
    const fields = match[2].trim().split(/\s+/).map(Number);
    if (fields.length >= 16 && fields.every(value => Number.isFinite(value) && value >= 0)) values.push({ name: match[1], received: fields[0], sent: fields[8] });
  }
  return values;
}
function darwinNetwork(text) {
  const interfaces = new Map();
  for (const line of text.split(/\r?\n/).slice(1)) {
    const fields = line.trim().split(/\s+/), name = fields[0];
    if (fields.length < 10 || !name || name === 'lo0' || name.endsWith('*')) continue;
    const received = number(fields.at(-5)), sent = number(fields.at(-2));
    if (received === null || sent === null || received < 0 || sent < 0) continue;
    const previous = interfaces.get(name);
    interfaces.set(name, { name, received: Math.max(previous?.received || 0, received), sent: Math.max(previous?.sent || 0, sent) });
  }
  return [...interfaces.values()].filter(value => value.received + value.sent > 0);
}
function preferredInterface(route, platform) {
  if (platform === 'Darwin') return /^\s*interface:\s+(\S+)/m.exec(route)?.[1] || null;
  return route.split(/\r?\n/).map(line => line.trim().split(/\s+/)).filter(row => row[1] === '00000000' && (parseInt(row[3], 16) & 1)).sort((a, b) => Number(a[6]) - Number(b[6]))[0]?.[0] || null;
}
function parseRemote(output, platform) {
  const parts = sections(output);
  let cpu, cpuPercent = null, cores, uptime;
  if (platform === 'Linux') {
    const ticks = /^cpu\s+(.+)$/m.exec(parts.CPU || '')?.[1].trim().split(/\s+/).slice(0, 8).map(Number);
    if (ticks?.length >= 4 && ticks.every(value => Number.isFinite(value) && value >= 0)) cpu = { total: ticks.reduce((a, b) => a + b, 0), idle: ticks[3] + (ticks[4] || 0) };
    cores = Number(/^cores\s+(\d+)/m.exec(parts.CPU || '')?.[1]);
    uptime = number(parts.UPTIME?.split(/\s+/)[0]);
  } else {
    const samples = [...(parts.CPU || '').matchAll(/CPU usage:\s+[\d.]+% user,\s*[\d.]+% sys,\s*([\d.]+)% idle/g)];
    if (samples.length >= 2) cpuPercent = clamp(100 - Number(samples.at(-1)[1]), 100);
    cores = Number(parts.CORES);
    const boot = Number(/sec\s*=\s*(\d+)/.exec(parts.UPTIME || '')?.[1]);
    const now = Number(parts.UPTIME?.split(/\r?\n/).at(-1));
    uptime = boot > 0 && now >= boot ? now - boot : null;
  }
  const mem = platform === 'Linux' ? linuxMemory(parts.MEMORY || '') : darwinMemory(parts.MEMORY || '', Number(parts.TOTAL));
  if (!mem || (!cpu && cpuPercent === null)) throw new Error('主机没有返回可用的 CPU / 内存统计；请确认允许 SSH 命令执行');
  const network = platform === 'Linux' ? linuxNetwork(parts.NETWORK || '') : darwinNetwork(parts.NETWORK || '');
  return {
    platform, cpu, cpuPercent, cores: cores > 0 ? cores : null, memory: mem, uptime,
    load: (parts.LOAD || '').replace(/[{}]/g, '').trim().split(/\s+/).slice(0, 3).map(Number).filter(Number.isFinite),
    disk: disk(parts.DISK || ''), network, preferredInterface: preferredInterface(parts.ROUTE || '', platform),
  };
}
async function localSample() {
  if (process.platform === 'linux') return parseRemote(await command('/bin/sh', ['-c', collectionScript('Linux')]), 'Linux');
  if (process.platform !== 'darwin') throw new Error('当前本地资源监控支持 macOS 和 Linux');
  const [vm, network, storage, route] = await Promise.all([
    command('/usr/bin/vm_stat'), command('/usr/sbin/netstat', ['-ibn']).catch(() => ''),
    command('/bin/df', ['-kP', fs.existsSync('/System/Volumes/Data') ? '/System/Volumes/Data' : '/']).catch(() => ''),
    command('/sbin/route', ['-n', 'get', 'default']).catch(() => ''),
  ]);
  const cpus = os.cpus();
  const mem = darwinMemory(vm, os.totalmem());
  if (!mem || !cpus.length) throw new Error('系统资源统计暂不可用');
  return {
    platform: 'Darwin', cpu: cpus.reduce((sum, cpu) => ({ total: sum.total + Object.values(cpu.times).reduce((a, b) => a + b, 0), idle: sum.idle + cpu.times.idle }), { total: 0, idle: 0 }),
    cpuPercent: null, cores: cpus.length, memory: mem, load: os.loadavg(), uptime: os.uptime(),
    disk: disk(storage), network: darwinNetwork(network), preferredInterface: preferredInterface(route, 'Darwin'),
  };
}
function sampleRates(raw, previous, time) {
  const elapsed = previous ? (time - previous.time) / 1000 : 0;
  const comparable = elapsed >= 0.1 && elapsed <= 15 && (previous.raw.uptime == null || raw.uptime == null || raw.uptime >= previous.raw.uptime);
  let cpuPercent = raw.cpuPercent;
  if (comparable && raw.cpu && previous.raw.cpu) {
    const total = raw.cpu.total - previous.raw.cpu.total, idle = raw.cpu.idle - previous.raw.cpu.idle;
    if (total > 0 && idle >= 0 && idle <= total) cpuPercent = 100 * (total - idle) / total;
  }
  const network = raw.network.map(current => {
    const before = comparable && previous.raw.network.find(value => value.name === current.name);
    const rate = field => before && current[field] >= before[field] ? (current[field] - before[field]) / elapsed : null;
    return { name: current.name, receiveRate: rate('received'), sendRate: rate('sent') };
  });
  return { platform: raw.platform, cpuPercent, cores: raw.cores, memory: raw.memory, disk: raw.disk, network, preferredInterface: raw.preferredInterface, load: raw.load, uptime: raw.uptime };
}
class Resources {
  constructor(sessions, options = {}) { this.sessions = sessions; this.states = new WeakMap(); this.local = options.localSample || localSample; this.remote = options.execText || execText; this.now = options.now || (() => performance.now()); }
  async read(id) {
    const item = this.sessions.items.get(id);
    if (!item || item.status !== 'ready') throw new Error('当前终端尚未连接');
    if (this.sessions.activeId !== id) throw new Error('当前终端已切换');
    let state = this.states.get(item);
    if (!state) { state = {}; this.states.set(item, state); }
    if (state.pending) return state.pending;
    if (state.result && this.now() - state.time < 2000) return state.result;
    state.pending = (async () => {
      const raw = item.type === 'local' ? await this.local() : parseRemote(await this.remote(item.conn, collectionScript(item.remoteOS), 6000), item.remoteOS);
      if (this.sessions.items.get(id) !== item || this.sessions.activeId !== id) throw new Error('当前终端已切换或关闭');
      const time = this.now();
      const result = { sessionId: id, sampledAt: Date.now(), ...sampleRates(raw, state.raw ? { raw: state.raw, time: state.time } : null, time) };
      state.raw = raw; state.time = time; state.result = result;
      return result;
    })().finally(() => { state.pending = null; });
    return state.pending;
  }
}
module.exports = { Resources, collectionScript, sections, linuxMemory, darwinMemory, disk, linuxNetwork, darwinNetwork, parseRemote, sampleRates, localSample };
