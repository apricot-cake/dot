import fs from 'node:fs';
import path from 'node:path';

// 保存済み索引は起動時にも更新されるので、ZIP から持ち込めるゴミ箱レコードを無制限に
// 読んではいけない。表示用の listTrashRecords とは違い、索引が要るのはこの小さな3欄だけ。
const TRASH_INDEX_RECORD_MAX_BYTES = 1024 * 1024;
const TRASH_INDEX_TOTAL_MAX_BYTES = 16 * TRASH_INDEX_RECORD_MAX_BYTES;
const TRASH_INDEX_MAX_FILES = 10_000;

export interface TrashIndexRecord {
  captureId: string;
  url: string | null;
  trashedAt: string | null;
}

export async function listTrashIndexRecords(trashDir: string): Promise<TrashIndexRecord[]> {
  let names: string[];
  try {
    names = await fs.promises.readdir(trashDir);
  } catch {
    return [];
  }
  const records: TrashIndexRecord[] = [];
  let bytesRead = 0;
  let filesExamined = 0;
  for (const f of names.sort()) {
    if (!f.toLowerCase().endsWith('.json')) continue;
    if (++filesExamined > TRASH_INDEX_MAX_FILES) break;
    let handle: fs.promises.FileHandle | null = null;
    try {
      const file = path.join(trashDir, f);
      handle = await fs.promises.open(file, 'r');
      const { size } = await handle.stat();
      if (size > TRASH_INDEX_RECORD_MAX_BYTES || bytesRead + size > TRASH_INDEX_TOTAL_MAX_BYTES) continue;
      bytesRead += size;
      // stat 後にファイルが伸びても readFile のように末尾まで追わず、確認したサイズだけ読む。
      const contents = Buffer.alloc(size);
      let offset = 0;
      while (offset < size) {
        const { bytesRead: chunkSize } = await handle.read(contents, offset, size - offset, offset);
        if (!chunkSize) break;
        offset += chunkSize;
      }
      const rec = JSON.parse(
        contents
          .subarray(0, offset)
          .toString('utf8')
          .replace(/^\uFEFF/, ''),
      );
      if (!rec || typeof rec !== 'object' || Array.isArray(rec)) continue;
      const captureId = f.replace(/\.json$/i, '');
      if (rec.captureId !== captureId) continue;
      if (rec.url != null && typeof rec.url !== 'string') continue;
      if (rec.trashedAt != null && typeof rec.trashedAt !== 'string') continue;
      records.push({ captureId, url: rec.url || null, trashedAt: rec.trashedAt || null });
    } catch {
      /* 壊れたものと、走査中に消えたものは索引に載せない */
    } finally {
      await handle?.close();
    }
  }
  return records;
}
