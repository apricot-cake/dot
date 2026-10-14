import { parentPort, workerData } from 'node:worker_threads';
import Database from 'better-sqlite3';
import { checkOrphans } from './lib-db-integrity.ts';
import { LibraryIntegrityRequestSchema, type LibraryIntegrityResult } from './lib-library-integrity.ts';

const { database, folder } = LibraryIntegrityRequestSchema.parse(workerData);
// 存在する DB の読み取り専用接続。初期化・移行・投稿者補完は実行しない。
const sqlite = new Database(database, { readonly: true, fileMustExist: true });
let result: LibraryIntegrityResult;
try {
  result = sqlite.transaction(() => {
    let dbOk = false;
    try {
      dbOk = sqlite.pragma('integrity_check', { simple: true }) === 'ok';
    } catch {
      // DB の健全性とメディアの検査結果を独立して報告する。
    }
    const { orphanMedia, missingMedia } = checkOrphans(folder, sqlite);
    return { dbOk, orphanCount: orphanMedia.length, missingCount: missingMedia.length };
  })();
} finally {
  sqlite.close();
}
parentPort?.postMessage(result);
parentPort?.close();
