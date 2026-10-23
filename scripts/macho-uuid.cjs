const crypto = require('node:crypto');
function inspectUUID(bytes) {
  if (bytes.length < 32 || bytes.readUInt32LE(0) !== 0xfeedfacf || bytes.readUInt32LE(4) !== 0x100000c) throw new Error('Expected thin ARM64 Mach-O');
  const count = bytes.readUInt32LE(16), end = 32 + bytes.readUInt32LE(20);
  if (!count || count > 4096 || end > bytes.length) throw new Error('Invalid Mach-O command table');
  let offset = 32, uuidOffset;
  for (let i = 0; i < count; i++) {
    if (offset + 8 > end) throw new Error('Truncated Mach-O command');
    const command = bytes.readUInt32LE(offset), size = bytes.readUInt32LE(offset + 4);
    if (size < 8 || size % 8 || offset + size > end) throw new Error('Invalid Mach-O command size');
    if (command === 0x1b) {
      if (size !== 24 || uuidOffset !== undefined) throw new Error('Invalid or duplicate LC_UUID');
      uuidOffset = offset + 8;
    }
    offset += size;
  }
  if (offset !== end || uuidOffset === undefined) throw new Error('Missing LC_UUID or invalid command table length');
  return { offset: uuidOffset, uuid: bytes.subarray(uuidOffset, uuidOffset + 16).toString('hex'), cpuType: bytes.readUInt32LE(4), cpuSubtype: bytes.readUInt32LE(8) };
}
function deriveUUID(bundleId, info) {
  const value = crypto.createHash('sha256').update(JSON.stringify(['MTerminal Mach-O identity v1', bundleId, info.cpuType, info.cpuSubtype, info.uuid])).digest().subarray(0, 16);
  value[6] = (value[6] & 0x0f) | 0x80; // RFC 9562 custom UUID, deterministic per app executable.
  value[8] = (value[8] & 0x3f) | 0x80;
  return value;
}
module.exports = { inspectUUID, deriveUUID };
