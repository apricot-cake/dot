import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { openDatabase } from '../../app/src/main/lib-db';
import { makeTagResolver, preparePostStmts, writePost } from '../../app/src/main/lib-db-record-writer';
import { drainInbox } from '../../app/src/main/lib-db-inbox';
import { buildEnvelope, writeInboxEvent } from '../../native-host/inbox.mts';
import { normalizePostRecord } from '../../native-host/post-record.mts';
import { cacheDir, configDir } from '../../native-host/paths.mts';
import { handleQuery, _resetSavedIndex } from '../../native-host/bridge.mts';

// Electron を一度も起動せず、Native Messaging ホストと同じ読み取り経路で確認する。
test('索引消失・破損後もDBと全未取込キューとゴミ箱から再構築し、DBへ書き込まない', async () => {
  const folder = path.join(configDir(), 'library');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(configDir(), 'config.json'), JSON.stringify({ saveFolder: folder }));
  const database = path.join(folder, 'dot.db');
  const handle = openDatabase(database);
  const url = 'https://x.com/known/status/100';
  writePost(preparePostStmts(handle.sqlite), makeTagResolver(handle.sqlite), { captureId: '1700000000000-aaaa', url, text: '保存済み本文', platform: 'x' });

  const deletedUrl = 'https://x.com/deleted/status/200';
  await writeInboxEvent(folder, buildEnvelope(normalizePostRecord({ captureId: '1700000000001-dddd', url: deletedUrl, text: '削除された投稿' })));
  drainInbox(folder, handle.sqlite);
  handle.sqlite.prepare('DELETE FROM posts WHERE captureId = ?').run('1700000000001-dddd');
  handle.sqlite.close();

  // 通常の差分走査上限500件より多い、まだDBに入っていない保存を作る。
  for (let i = 0; i < 501; i++) {
    await writeInboxEvent(folder, buildEnvelope(normalizePostRecord({ captureId: `1700000001000-${i.toString(16).padStart(4, '0')}`, url: `https://x.com/pending/status/${1000 + i}`, text: `未取込 ${i}` })));
  }
  const trashUrl = 'https://x.com/trash/status/300';
  const trashDir = path.join(folder, '.trash');
  fs.mkdirSync(trashDir);
  fs.writeFileSync(path.join(trashDir, '1700000000002-bbbb.json'), JSON.stringify({ captureId: '1700000000002-bbbb', url: trashUrl, trashedAt: '2026-10-10T00:00:00Z' }));
  const hash = () => createHash('sha256').update(fs.readFileSync(database)).digest('hex');
  const before = hash();
  const firstPending = 'https://x.com/pending/status/1000';
  const lastPending = 'https://x.com/pending/status/1500';
  const ask = () => handleQuery({ type: 'query', urls: [url, deletedUrl, firstPending, lastPending, trashUrl] });
  const first = await ask();
  expect(first.results[url]?.id).toBe('1700000000000-aaaa');
  expect(first.results[firstPending]).not.toBeNull();
  expect(first.results[lastPending]).not.toBeNull();
  expect(first.results[deletedUrl]).toBeNull();
  expect(first.trashed?.[trashUrl]?.id).toBe('1700000000002-bbbb');
  const snapshot = path.join(cacheDir(), 'bridge-saved-index.json');
  expect(JSON.parse(fs.readFileSync(snapshot, 'utf8')).saveFolder).toBe(folder);
  expect(hash()).toBe(before);
  const read = vi.spyOn(fs, 'readFileSync');
  try {
    await ask();
    expect(read.mock.calls.some(([file]) => file === snapshot)).toBe(false);
  } finally {
    read.mockRestore();
  }

  fs.writeFileSync(snapshot, '{broken');
  _resetSavedIndex();
  const rebuilt = await ask();
  expect(rebuilt.results).toEqual(first.results);
  expect(rebuilt.trashed).toEqual(first.trashed);
  expect(hash()).toBe(before);
}, 30_000);
