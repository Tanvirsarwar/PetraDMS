import fs from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { PetraError } from '@petra/core';
import { crc32 } from './exportFiles';

interface CentralEntry { name: string; method: number; csize: number; usize: number; crc: number; offset: number }

/** Reads the central directory of a ZIP from the end of the file, so a large backup is never loaded just to list it. */
function centralDirectory(fd: number, size: number): CentralEntry[] {
  const tailLen = Math.min(size, 70_000);
  const tail = Buffer.alloc(tailLen);
  fs.readSync(fd, tail, 0, tailLen, size - tailLen);
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new PetraError('BACKUP_INVALID', 'not a backup file', { why: 'zip' });
  const count = tail.readUInt16LE(eocd + 10);
  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdOff = tail.readUInt32LE(eocd + 16);
  if (cdOff + cdSize > size) throw new PetraError('BACKUP_INVALID', 'backup file is cut short', { why: 'truncated' });
  const cd = Buffer.alloc(cdSize);
  fs.readSync(fd, cd, 0, cdSize, cdOff);
  const out: CentralEntry[] = [];
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (cd.readUInt32LE(p) !== 0x02014b50) throw new PetraError('BACKUP_INVALID', 'backup file is damaged', { why: 'central' });
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    out.push({
      method: cd.readUInt16LE(p + 10), crc: cd.readUInt32LE(p + 16), csize: cd.readUInt32LE(p + 20), usize: cd.readUInt32LE(p + 24),
      offset: cd.readUInt32LE(p + 42), name: cd.toString('utf8', p + 46, p + 46 + nameLen)
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function readEntry(fd: number, e: CentralEntry): Buffer {
  const head = Buffer.alloc(30);
  fs.readSync(fd, head, 0, 30, e.offset);
  if (head.readUInt32LE(0) !== 0x04034b50) throw new PetraError('BACKUP_INVALID', 'backup file is damaged', { why: 'local' });
  const start = e.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
  const raw = Buffer.alloc(e.csize);
  fs.readSync(fd, raw, 0, e.csize, start);
  const data = e.method === 0 ? raw : e.method === 8 ? inflateRawSync(raw) : null;
  if (!data) throw new PetraError('BACKUP_INVALID', 'unsupported compression', { why: 'method' });
  if (data.length !== e.usize || crc32(data) !== e.crc) throw new PetraError('BACKUP_INVALID', 'backup file is damaged', { why: 'crc' });
  return data;
}

/** Names of the entries and the bytes of one of them, from a ZIP on disk. */
export function readZipFile(file: string, names: string[]): { names: string[]; files: Map<string, Buffer> } {
  const fd = fs.openSync(file, 'r');
  try {
    const entries = centralDirectory(fd, fs.fstatSync(fd).size);
    const files = new Map<string, Buffer>();
    for (const n of names) {
      const e = entries.find((x) => x.name === n);
      if (!e) throw new PetraError('BACKUP_INVALID', `backup is missing ${n}`, { why: 'missing', name: n });
      files.set(n, readEntry(fd, e));
    }
    return { names: entries.map((e) => e.name), files };
  } finally {
    fs.closeSync(fd);
  }
}
