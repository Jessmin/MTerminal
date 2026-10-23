const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Resources, collectionScript, parseRemote, linuxMemory, darwinMemory, darwinNetwork, sampleRates, disk } = require('../electron/resources.cjs');
const marker = name => `\n__MTERMINAL_RESOURCE_V1__${name}\n`;
const linuxOutput = marker('CPU') + 'cpu 100 20 30 400 10 5 5 0 80 9\ncores 4\n' + marker('MEMORY') + 'MemTotal: 1024000 kB\nMemFree: 100000 kB\nMemAvailable: 256000 kB\n' + marker('UPTIME') + '1200.00 3000.00\n' + marker('LOAD') + '0.25 0.50 0.75 1/100 1234\n' + marker('NETWORK') + 'Inter-| Receive | Transmit\n eth0: 10000 1 0 0 0 0 0 0 20000 1 0 0 0 0 0 0\n lo: 99999 1 0 0 0 0 0 0 99999 1 0 0 0 0 0 0\n' + marker('ROUTE') + 'Iface Destination Gateway Flags RefCnt Use Metric Mask\neth0 00000000 0100000A 0003 0 0 100 00000000\n' + marker('DISK') + 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda1 1000000 500000 400000 56% /\n' + marker('END');

test('Linux resource protocol reads actual CPU ticks, MemAvailable and byte counters without counting guest time twice', () => {
  const value = parseRemote('login banner\n' + linuxOutput, 'Linux');
  assert.deepEqual(value.cpu, { total: 570, idle: 410 });
  assert.equal(value.cores, 4); assert.equal(value.memory.percent, 75);
  assert.deepEqual(value.network, [{ name: 'eth0', received: 10000, sent: 20000 }]);
  assert.equal(value.preferredInterface, 'eth0'); assert.deepEqual(value.load, [.25, .5, .75]);
  assert.equal(value.disk.mount, '/'); assert.equal(value.disk.percent, 60);
  assert.throws(() => parseRemote('command denied', 'Linux'), /没有返回/);
  assert.throws(() => collectionScript('Windows_NT'), /支持/);
});
test('memory calculations retain zero available memory and do not double-count purgeable macOS pages', () => {
  assert.equal(linuxMemory('MemTotal: 1000 kB\nMemAvailable: 0 kB\nMemFree: 100 kB').percent, 100);
  assert.equal(linuxMemory('MemTotal: 1000 kB\nMemFree: 100 kB\nCached: 200 kB\nSReclaimable: 50 kB\nShmem: 25 kB').available, 325 * 1024);
  const vm = 'Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free: 10.\nPages inactive: 20.\nPages speculative: 5.\nPages purgeable: 15.\n';
  assert.equal(darwinMemory(vm, 100 * 16384).available, 35 * 16384);
  assert.equal(darwinMemory('inaccessible', 1000), null);
  assert.equal(disk('permission denied'), null);
  assert.equal(disk('/dev/full 1000 1000 -1 101% /').available, 0);
  assert.equal(linuxMemory('MemTotal: ' + '9'.repeat(400) + ' kB\nMemAvailable: 1 kB'), null);
});
test('macOS network duplicate address rows and missing link addresses never multiply bytes', () => {
  const data = darwinNetwork('Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll\nen0 1500 <Link#1> aa:bb:cc 10 0 3000 20 0 6000 0\nen0 1500 192.168.1 192.168.1.1 10 - 3000 20 - 6000 -\nfeth1 2800 <Link#2> 10 0 4000 20 0 8000 0\nlo0 16384 <Link#3> 10 0 99999 20 0 99999 0\n');
  assert.deepEqual(data, [{ name: 'en0', received: 3000, sent: 6000 }, { name: 'feth1', received: 4000, sent: 8000 }]);
});
test('CPU and network use consecutive samples; first samples, resets, reboots and long pauses show unavailable rates', () => {
  const before = parseRemote(linuxOutput, 'Linux');
  const raw = { ...before, uptime: 1203, cpu: { total: 970, idle: 710 }, network: [{ name: 'eth0', received: 13000, sent: 26000 }] };
  const result = sampleRates(raw, { raw: before, time: 1000 }, 4000);
  assert.equal(result.cpuPercent, 25); assert.equal(result.network[0].receiveRate, 1000); assert.equal(result.network[0].sendRate, 2000);
  assert.equal(sampleRates(raw, null, 4000).cpuPercent, null);
  assert.equal(sampleRates(raw, { raw: before, time: 1000 }, 31000).network[0].sendRate, null);
  assert.equal(sampleRates({ ...raw, uptime: 5 }, { raw: before, time: 1000 }, 4000).cpuPercent, null);
  assert.equal(sampleRates({ ...raw, network: [{ name: 'eth0', received: 5, sent: 10 }] }, { raw: before, time: 1000 }, 4000).network[0].receiveRate, null);
});
test('sampling is coalesced and cached; a late result cannot be used after the active session changes', async () => {
  const item = { id: 'a', type: 'local', status: 'ready' };
  const sessions = { activeId: 'a', items: new Map([['a', item]]) };
  let calls = 0, now = 0, finish;
  const resources = new Resources(sessions, { now: () => now, localSample: () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  const first = resources.read('a'), second = resources.read('a');
  finish(parseRemote(linuxOutput, 'Linux'));
  assert.deepEqual(await first, await second); assert.equal(calls, 1);
  await resources.read('a'); assert.equal(calls, 1);
  now = 3000;
  const pending = resources.read('a'); sessions.activeId = 'b'; finish(parseRemote(linuxOutput, 'Linux'));
  await assert.rejects(pending, /切换/);
  await assert.rejects(resources.read('a'), /切换/); assert.equal(calls, 2);
  sessions.items.delete('a'); await assert.rejects(resources.read('a'), /尚未连接/);
});
