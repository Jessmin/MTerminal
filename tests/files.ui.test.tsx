import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import type { Bridge, Entry } from '../src/types';

const harness = vi.hoisted(() => ({ listeners: {} as Record<string, (event: any) => void>, api: {} as any }));
vi.mock('../src/TerminalPane', () => ({ TerminalPane: ({ session, active }: any) => <div className="mock-terminal" data-session={session.id} data-active={String(active)} /> }));
vi.mock('../src/types', async original => ({ ...await original() as object, api: harness.api }));

let root: Root, container: HTMLDivElement;
const file = (name: string): Entry => ({ name, directory: false, symlink: false, size: 3, modified: 1000, mode: 0o644 });
const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); };
const click = async (element: Element | null) => { expect(element).toBeTruthy(); await act(async () => { element!.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); await flush(); };
const emit = async (channel: string, event: any) => { await act(async () => harness.listeners[channel]?.(event)); await flush(); };
const activeId = () => container.querySelector<HTMLElement>('.mock-terminal[data-active="true"]')!.dataset.session!;
const tick = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(1600); }); };

beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  harness.listeners = {};
  for (const [method, channel] of Object.entries({ onState: 'state', onCwd: 'cwd', onVerify: 'verify', onTrustResolved: 'resolved', onTransfer: 'transfer', onNotice: 'notice', onHostsChanged: 'hosts' })) {
    harness.api[method] = (listener: any) => { harness.listeners[channel] = listener; return () => delete harness.listeners[channel]; };
  }
  Object.assign(harness.api, {
    info: vi.fn(async () => ({ platform: 'darwin', home: '/home/local', version: 'test', shell: '/bin/zsh', shellLabel: 'zsh', encryptedStorage: false })),
    hosts: vi.fn(async () => [{ id: 'remote-host', name: 'Test SSH', hostname: 'test.invalid', username: 'tester', port: 22, group: 'test', auth: 'password', privateKeyPath: '', note: '' }]),
    activateSession: vi.fn(async () => {}), closeSession: vi.fn(async () => {}),
    resourceSample: vi.fn(async () => { throw new Error('该测试不采集主机资源'); }),
    listFiles: vi.fn(async ({ side, directory }: any) => ({ directory: directory === '.' ? '/remote/home' : directory, entries: [file(side === 'local' ? 'local-only.txt' : 'remote-only.txt')] })),
  });
  (window as any).mterminal = harness.api as Bridge;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  const { default: App } = await import('../src/App');
  await act(async () => root.render(<App />)); await flush();
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });

test('only the active session has a file pane; cwd events are scoped to that session', async () => {
  const first = activeId();
  await emit('state', { id: first, status: 'ready', detail: 'zsh' });
  await emit('cwd', { id: first, directory: '/local/one', revision: 1 });
  expect(container.querySelectorAll('.file-pane')).toHaveLength(1);
  expect((container.querySelector('[aria-label="本地路径"]') as HTMLInputElement).value).toBe('/local/one');
  expect(container.querySelector('[aria-label="远程文件"]')).toBeNull();
  await click(container.querySelector('.heading-actions button'));
  const second = activeId(); expect(second).not.toBe(first);
  await emit('state', { id: second, status: 'ready', detail: 'zsh' });
  await emit('cwd', { id: second, directory: '/local/two', revision: 1 });
  await emit('cwd', { id: first, directory: '/background/changed', revision: 2 });
  expect((container.querySelector('[aria-label="本地路径"]') as HTMLInputElement).value).toBe('/local/two');
  await click(container.querySelectorAll('[role="tab"]')[0]);
  expect((container.querySelector('[aria-label="本地路径"]') as HTMLInputElement).value).toBe('/background/changed');
  expect(harness.api.activateSession).toHaveBeenLastCalledWith(first);
});

test('SSH activation replaces local files, and stale remote results cannot repaint a local tab', async () => {
  const local = activeId();
  await emit('state', { id: local, status: 'ready', detail: 'zsh' });
  await click(container.querySelector('.host-main'));
  await click([...container.querySelectorAll('button')].find(button => button.textContent === '连接主机')!);
  const remote = activeId();
  await emit('state', { id: remote, status: 'ready', detail: 'tester@test.invalid' });
  await emit('cwd', { id: remote, directory: '/remote/project', revision: 1 });
  expect(container.querySelectorAll('.file-pane')).toHaveLength(1);
  expect(container.querySelector('[aria-label="本地文件"]')).toBeNull();
  expect(container.textContent).toContain('remote-only.txt');
  let finish: (value: any) => void = () => {};
  harness.api.listFiles.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await emit('cwd', { id: remote, directory: '/remote/slow', revision: 2 });
  await click(container.querySelectorAll('[role="tab"]')[0]);
  await act(async () => finish({ directory: '/remote/slow', entries: [file('STALE-REMOTE.txt')] })); await flush();
  expect(container.querySelector('[aria-label="远程文件"]')).toBeNull();
  expect(container.textContent).toContain('local-only.txt');
  expect(container.textContent).not.toContain('STALE-REMOTE.txt');
});

test('automatic refresh discovers command-created files without clearing selection or path drafts', async () => {
  const id = activeId();
  await emit('state', { id, status: 'ready', detail: 'zsh' });
  await emit('cwd', { id, directory: '/local/work', revision: 1 });
  await click(container.querySelector('input[aria-label="选择 local-only.txt"]'));
  const input = container.querySelector<HTMLInputElement>('[aria-label="本地路径"]')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { setter.call(input, '/draft/path'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  harness.api.listFiles.mockResolvedValue({ directory: '/local/work', entries: [file('local-only.txt'), file('created-by-command.txt')] });
  vi.useFakeTimers();
  // Remount the file panel while timers are fake so its polling interval is controlled.
  await act(async () => { container.querySelector<HTMLButtonElement>('[title^="切换文件面板"]')!.click(); });
  await act(async () => { container.querySelector<HTMLButtonElement>('[title^="切换文件面板"]')!.click(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(5); });
  harness.api.listFiles.mockResolvedValue({ directory: '/local/work', entries: [file('local-only.txt'), file('created-by-command.txt'), file('after-refresh.txt')] });
  await act(async () => { container.querySelector<HTMLInputElement>('input[aria-label="选择 local-only.txt"]')!.click(); });
  const currentInput = container.querySelector<HTMLInputElement>('[aria-label="本地路径"]')!;
  await act(async () => { setter.call(currentInput, '/draft/path'); currentInput.dispatchEvent(new Event('input', { bubbles: true })); });
  await tick();
  expect(container.textContent).toContain('after-refresh.txt');
  expect(container.querySelector<HTMLInputElement>('input[aria-label="选择 local-only.txt"]')!.checked).toBe(true);
  expect(currentInput.value).toBe('/draft/path');
});
