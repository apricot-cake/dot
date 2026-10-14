import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test } from 'vitest';
import { openDatabase } from '../../app/src/main/lib-db.ts';
import { inspectLibraryIntegrity } from '../../app/src/main/lib-library-integrity.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

test('実スレッドで検査し、不正な旧データがあっても欠落メディアを検出してDBを変更しない', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'dot-integrity-worker-'));
  dirs.push(folder);
  const database = path.join(folder, 'dot.db');
  const handle = openDatabase(database);
  try {
    handle.sqlite.exec("INSERT INTO posts (captureId,image,capturedAt,updatedAt) VALUES ('1700000000000-aa01','missing.jpg','2026-10-13','2026-10-13')");
    fs.writeFileSync(path.join(folder, '1700000000001-aa02.json'), JSON.stringify({ media: [{ url: null, file: 'bad.jpg' }] }));
    fs.writeFileSync(path.join(folder, '1700000000002-aa03.jpg'), 'orphan');
    const before = handle.sqlite.prepare('SELECT * FROM posts').all();
    const entry = fileURLToPath(new URL('../../app/src/main/library-integrity-worker.ts', import.meta.url));
    let turns = 0;
    const timer = setInterval(() => {
      turns++;
    }, 1);
    try {
      await expect(inspectLibraryIntegrity(database, folder, entry)).resolves.toEqual({ dbOk: true, orphanCount: 1, missingCount: 1 });
    } finally {
      clearInterval(timer);
    }
    expect(turns).toBeGreaterThan(0);
    expect(handle.sqlite.prepare('SELECT * FROM posts').all()).toEqual(before);
    expect(fs.readFileSync(path.join(folder, '1700000000002-aa03.jpg'), 'utf8')).toBe('orphan');
  } finally {
    handle.sqlite.close();
  }
});
