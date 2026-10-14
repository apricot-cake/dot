import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { z } from 'zod';

export const LibraryIntegrityRequestSchema = z.object({ database: z.string().min(1), folder: z.string().min(1) });
export const LibraryIntegrityResultSchema = z.object({ dbOk: z.boolean(), orphanCount: z.number().int().nonnegative(), missingCount: z.number().int().nonnegative() });
export type LibraryIntegrityResult = z.output<typeof LibraryIntegrityResultSchema>;

const workerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'library-integrity-worker.js');

// SQLite とファイルの全走査は専用スレッドで行い、メインの IPC・画像配信を止めない。
export function inspectLibraryIntegrity(database: string, folder: string, entry = workerPath): Promise<LibraryIntegrityResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(entry, { workerData: LibraryIntegrityRequestSchema.parse({ database, folder }) });
    let result: LibraryIntegrityResult | undefined;
    let failure: Error | undefined;
    const timer = setTimeout(() => {
      failure = new Error('Library integrity check timed out');
      void worker.terminate();
    }, 120_000);
    worker.once('message', (value: unknown) => {
      const parsed = LibraryIntegrityResultSchema.safeParse(value);
      if (parsed.success) result = parsed.data;
      else {
        failure = new Error('Invalid library integrity result');
        void worker.terminate();
      }
    });
    worker.once('error', (error) => {
      failure = error instanceof Error ? error : new Error(String(error));
    });
    // 接続が閉じ、スレッドが終了してからライブラリ移動の待機を解く。
    worker.once('exit', (code) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code !== 0 || !result) reject(new Error(`Library integrity worker exited without a result (${code})`));
      else resolve(result);
    });
  });
}
