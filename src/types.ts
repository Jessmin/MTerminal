export type Host = {
  id: string; name: string; hostname: string; port: number; username: string;
  group: string; auth: 'password' | 'key'; privateKeyPath: string; note: string; hasSecret?: boolean;
};
export type Session = {
  id: string; type: 'local' | 'ssh'; label: string; hostId?: string;
  cwd?: string; secret?: string; saveSecret?: boolean; useSavedSecret?: boolean;
  cwdRevision?: number;
  status: 'connecting' | 'ready' | 'exited' | 'error'; detail?: string;
};
export type Entry = { name: string; directory: boolean; symlink: boolean; size: number; modified: number; mode: number };
export type Side = 'local' | 'remote';
export type Location = { side: Side; sessionId?: string; directory?: string; filename?: string };
export type Transfer = {
  id: string; sessionId: string; direction: 'upload' | 'download'; name: string;
  source: string; target: string; bytes: number; total: number; startedAt: number;
  status: 'queued' | 'running' | 'done' | 'cancelled' | 'error'; error?: string;
};
export type Verification = {
  challengeId: string; sessionId: string; hostname: string; port: number;
  fingerprint: string; previous: string | null; changed: boolean;
};
export type AppInfo = { platform: string; home: string; version: string; shell: string; shellLabel: string; encryptedStorage: boolean };
export type ResourceSample = {
  sessionId: string; sampledAt: number; platform: string; cpuPercent: number | null; cores: number | null;
  memory: { total: number; available: number; used: number; percent: number; source: string };
  disk: { mount: string; total: number; available: number; used: number; percent: number } | null;
  network: { name: string; receiveRate: number | null; sendRate: number | null }[];
  preferredInterface: string | null; load: number[]; uptime: number | null;
};
export type EditorFile = { side: Side; sessionId?: string; filename: string; text: string; revision: string };
type Unsubscribe = () => void;
export interface Bridge {
  info(): Promise<AppInfo>;
  hosts(): Promise<Host[]>;
  saveHost(host: Partial<Host>): Promise<Host>;
  removeHost(id: string): Promise<void>;
  forgetSecret(id: string): Promise<void>;
  startSession(input: Partial<Session> & { cols?: number; rows?: number }): Promise<{ id: string }>;
  closeSession(id: string): Promise<void>;
  activateSession(id: string | null): Promise<void>;
  resourceSample(id: string): Promise<ResourceSample>;
  write(id: string, data: string): void;
  resize(id: string, cols: number, rows: number): void;
  ack(id: string, amount: number): void;
  onData(fn: (event: { id: string; data: string }) => void): Unsubscribe;
  onState(fn: (event: { id: string; status: Session['status']; detail: string }) => void): Unsubscribe;
  onCwd(fn: (event: { id: string; directory: string; revision: number; source: string }) => void): Unsubscribe;
  onVerify(fn: (event: Verification) => void): Unsubscribe;
  onTrustResolved(fn: (event: { challengeId: string }) => void): Unsubscribe;
  onTransfer(fn: (event: Transfer) => void): Unsubscribe;
  onNotice(fn: (event: { message: string }) => void): Unsubscribe;
  onHostsChanged(fn: () => void): Unsubscribe;
  trust(id: string, decision: 'save' | 'once' | 'reject'): Promise<void>;
  listFiles(input: Location): Promise<{ directory: string; entries: Entry[] }>;
  mutateFile(input: Location & { action: string; name: string; nextName?: string }): Promise<void>;
  readText(input: Location): Promise<{ text: string; revision: string }>;
  writeText(input: Location & { text: string; revision: string }): Promise<{ revision: string }>;
  transfer(input: { direction: 'upload' | 'download'; sessionId: string; sources: string[]; directory: string }): Promise<string[]>;
  cancelTransfer(id: string): Promise<void>;
  chooseKey(): Promise<string | null>;
  chooseUpload(): Promise<string[]>;
  chooseDirectory(): Promise<string | null>;
  clipboardRead(): Promise<string>;
  clipboardWrite(text: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  filePath(file: File): string;
}
declare global { interface Window { mterminal: Bridge } }
export const api = window.mterminal;
export const message = (error: unknown) => error instanceof Error ? error.message : String(error);
export { join, parent } from '../shared/paths.mjs';
export function size(bytes: number) {
  if (bytes < 1024) return bytes + ' B';
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes / 1024, index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index++; }
  return value.toFixed(value < 10 ? 1 : 0) + ' ' + units[index];
}
