import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import type { ResourceSample, Session } from '../src/types';
const harness = vi.hoisted(() => ({ api: { resourceSample: vi.fn() } }));
vi.mock('../src/types', async original => ({ ...await original() as object, api: harness.api }));
import { ResourceMonitor } from '../src/ResourceMonitor';
let root: Root, container: HTMLDivElement;
const session = (id: string, status: Session['status'] = 'ready'): Session => ({ id, type: 'ssh', label: id, status });
const sample = (id: string, cpuPercent = 55.5): ResourceSample => ({
  sessionId: id, sampledAt: Date.now(), platform: 'Linux', cpuPercent, cores: 4,
  memory: { total: 8 * 1024 ** 3, available: 4 * 1024 ** 3, used: 4 * 1024 ** 3, percent: 50, source: 'linux-available' },
  disk: { mount: '/', total: 100 * 1024 ** 3, available: 80 * 1024 ** 3, used: 20 * 1024 ** 3, percent: 20 },
  network: [{ name: 'eth0', receiveRate: 1024, sendRate: 2048 }, { name: 'tun0', receiveRate: 10240, sendRate: 20480 }],
  preferredInterface: 'eth0', load: [.1, .2, .3], uptime: 3600,
});
const render = async (id: string, status?: Session['status']) => { await act(async () => root.render(<ResourceMonitor session={session(id, status)} hostName={`Host ${id}`} />)); };
const click = async (name: string) => { await act(async () => container.querySelector<HTMLButtonElement>(`[aria-label="${name}"]`)!.click()); };
const tick = async (ms: number) => { await act(async () => vi.advanceTimersByTimeAsync(ms)); };
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  vi.useFakeTimers();
  harness.api.resourceSample.mockReset().mockImplementation(async (id: string) => sample(id));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });

test('switching sessions discards a delayed sample from the old host', async () => {
  let finish: (value: ResourceSample) => void = () => {};
  harness.api.resourceSample.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await render('old'); await render('new');
  expect(container.textContent).toContain('Host new'); expect(container.textContent).toContain('55.5%');
  await act(async () => finish(sample('old', 12.3)));
  expect(container.textContent).not.toContain('12.3%');
  expect(harness.api.resourceSample).toHaveBeenLastCalledWith('new');
});
test('pausing, hiding, collapsing and disconnecting stop further resource requests', async () => {
  await render('active'); expect(harness.api.resourceSample).toHaveBeenCalledTimes(1);
  await tick(3100); expect(harness.api.resourceSample).toHaveBeenCalledTimes(2);
  await click('暂停资源监控'); await tick(7000); expect(harness.api.resourceSample).toHaveBeenCalledTimes(2);
  await click('恢复资源监控'); expect(harness.api.resourceSample).toHaveBeenCalledTimes(3);
  await act(async () => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await tick(7000); expect(harness.api.resourceSample).toHaveBeenCalledTimes(3);
  await act(async () => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  expect(harness.api.resourceSample).toHaveBeenCalledTimes(4);
  await click('收起资源监控'); await tick(7000); expect(harness.api.resourceSample).toHaveBeenCalledTimes(4);
  await click('展开资源监控'); expect(harness.api.resourceSample).toHaveBeenCalledTimes(5);
  await render('active', 'exited'); await tick(7000); expect(harness.api.resourceSample).toHaveBeenCalledTimes(5);
  expect(container.textContent).toContain('等待连接');
});
test('network selector displays a single interface instead of adding tunnel and physical traffic', async () => {
  await render('active');
  expect(container.textContent).toContain('1.0 KiB/s'); expect(container.textContent).not.toContain('10 KiB/s');
  const select = container.querySelector<HTMLSelectElement>('[aria-label="监控网卡"]')!;
  await act(async () => { select.value = 'tun0'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(container.textContent).toContain('10 KiB/s'); expect(container.textContent).not.toContain('1.0 KiB/s');
});
