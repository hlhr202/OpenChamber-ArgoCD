/** Small, deterministic ZIP writer/reader for our own bounded, stored-only
 * release format. Not a general untrusted archive extraction API. */
const MAX_BYTES = 8 * 1024 * 1024;
function safeName(name: string): boolean { return /^[A-Za-z0-9_./-]{1,160}$/.test(name) && !name.startsWith('/') && name.split('/').every((part) => part && part !== '.' && part !== '..'); }
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
export function zipFiles(files: ReadonlyMap<string, Buffer>): Buffer {
  if (!files.size || files.size > 64) throw new Error('Invalid release file count.');
  const locals: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  for (const [name, bytes] of [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    if (!safeName(name) || bytes.length > MAX_BYTES) throw new Error('Invalid release file.');
    const path = Buffer.from(name); const crc = crc32(bytes);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
    // DOS date 1980-01-01, no wall-clock time, host filesystem attrs or extras.
    header.writeUInt16LE(33, 12); header.writeUInt32LE(crc, 14); header.writeUInt32LE(bytes.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(path.length, 26);
    locals.push(header, path, bytes);
    const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(33, 14);
    entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(bytes.length, 20); entry.writeUInt32LE(bytes.length, 24); entry.writeUInt16LE(path.length, 28); entry.writeUInt32LE(offset, 42);
    central.push(entry, path); offset += header.length + path.length + bytes.length;
    if (offset > MAX_BYTES) throw new Error('Release exceeds archive budget.');
  }
  const directory = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.size, 8); end.writeUInt16LE(files.size, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
export function readReleaseZip(zip: Buffer): Map<string, Buffer> {
  const bad = () => new Error('Invalid release archive.');
  if (zip.length < 22 || zip.length > MAX_BYTES + 65536) throw bad();
  const end = zip.length - 22;
  if (zip.readUInt32LE(end) !== 0x06054b50 || zip.readUInt32LE(end + 4) !== 0 || zip.readUInt16LE(end + 20) !== 0) throw bad();
  const count = zip.readUInt16LE(end + 10); const offset = zip.readUInt32LE(end + 16); const size = zip.readUInt32LE(end + 12);
  if (!count || count > 64 || zip.readUInt16LE(end + 8) !== count || offset + size !== end) throw bad();
  let cursor = offset; let localEnd = 0; const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || zip.readUInt32LE(cursor) !== 0x02014b50 || zip.readUInt32LE(cursor + 8) !== 0 || zip.readUInt16LE(cursor + 12) !== 0 || zip.readUInt16LE(cursor + 14) !== 33) throw bad();
    const length = zip.readUInt32LE(cursor + 24); const nameLength = zip.readUInt16LE(cursor + 28); const local = zip.readUInt32LE(cursor + 42); const crc = zip.readUInt32LE(cursor + 16);
    if (length > MAX_BYTES || zip.readUInt32LE(cursor + 20) !== length || zip.readUInt16LE(cursor + 30) || zip.readUInt16LE(cursor + 32) || zip.readUInt16LE(cursor + 34) || zip.readUInt32LE(cursor + 38) || local !== localEnd || local + 30 > offset || cursor + 46 + nameLength > end) throw bad();
    const name = zip.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8'); if (!safeName(name) || files.has(name)) throw bad();
    if (zip.readUInt32LE(local) !== 0x04034b50 || zip.readUInt16LE(local + 4) !== 20 || zip.readUInt32LE(local + 6) !== 0 || zip.readUInt16LE(local + 10) !== 0 || zip.readUInt16LE(local + 12) !== 33 || zip.readUInt32LE(local + 14) !== crc || zip.readUInt32LE(local + 18) !== length || zip.readUInt32LE(local + 22) !== length || zip.readUInt16LE(local + 26) !== nameLength || zip.readUInt16LE(local + 28)) throw bad();
    const start = local + 30 + nameLength; localEnd = start + length;
    if (localEnd > offset || zip.subarray(local + 30, start).toString('utf8') !== name) throw bad();
    const bytes = Buffer.from(zip.subarray(start, localEnd)); if (crc32(bytes) !== crc) throw bad(); files.set(name, bytes); cursor += 46 + nameLength;
  }
  if (cursor !== end || localEnd !== offset) throw bad(); return files;
}
