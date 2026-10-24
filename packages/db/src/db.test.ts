import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, healthInfo } from './index';

describe('openDatabase', () => {
  it('uses WAL, synchronous=FULL and foreign keys', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petra-db-'));
    const db = openDatabase(path.join(dir, 'x.db'));
    const h = healthInfo(db);
    expect(h.journalMode).toBe('wal');
    expect(h.synchronous).toBe(2);
    expect(h.foreignKeys).toBe(1);
    expect(h.integrity).toBe('ok');
    db.close();
  });
});
