const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { inspectUUID, deriveUUID } = require('../scripts/macho-uuid.cjs');

test('packaged executable UUIDs are deterministic per bundle and preserve all other bytes', { skip: process.platform !== 'darwin' }, () => {
  const original = fs.readFileSync('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
  const info = inspectUUID(original);
  const value = deriveUUID('local.mterminal.desktop', info);
  assert.deepEqual(value, deriveUUID('local.mterminal.desktop', info));
  assert.notDeepEqual(value, deriveUUID('com.github.Electron', info));
  assert.notEqual(value.toString('hex'), info.uuid);
  const updated = Buffer.from(original);
  value.copy(updated, info.offset);
  assert.deepEqual(updated.subarray(0, info.offset), original.subarray(0, info.offset));
  assert.deepEqual(updated.subarray(info.offset + 16), original.subarray(info.offset + 16));
  assert.equal(inspectUUID(updated).uuid, value.toString('hex'));
});
test('UUID editing rejects unsupported or malformed Mach-O rather than guessing offsets', () => {
  const fixture = Buffer.alloc(80);
  fixture.writeUInt32LE(0xfeedfacf, 0); fixture.writeUInt32LE(0x100000c, 4);
  fixture.writeUInt32LE(2, 16); fixture.writeUInt32LE(48, 20);
  for (const offset of [32, 56]) { fixture.writeUInt32LE(0x1b, offset); fixture.writeUInt32LE(24, offset + 4); }
  assert.throws(() => inspectUUID(fixture), /duplicate/);
  const truncated = Buffer.from(fixture); truncated.writeUInt32LE(96, 36);
  assert.throws(() => inspectUUID(truncated), /size/);
  assert.throws(() => inspectUUID(Buffer.from('cafebabe', 'hex')), /thin ARM64/);
  const missing = Buffer.from(fixture); missing.writeUInt32LE(0x19, 32); missing.writeUInt32LE(0x19, 56);
  assert.throws(() => inspectUUID(missing), /Missing LC_UUID/);
});
