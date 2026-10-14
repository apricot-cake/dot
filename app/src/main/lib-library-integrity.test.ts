import { EventEmitter } from 'node:events';
import { afterEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({ workers: [] as Array<EventEmitter & { terminate: ReturnType<typeof vi.fn> }> }));
vi.mock('node:worker_threads', () => ({
  Worker: class extends EventEmitter {
    terminate = vi.fn(async () => {
      this.emit('exit', 1);
      return 1;
    });
    constructor() {
      super();
      state.workers.push(this);
    }
  },
}));
import { inspectLibraryIntegrity } from './lib-library-integrity.ts';

afterEach(() => {
  state.workers = [];
  vi.useRealTimers();
});

test('結果の到着後もスレッドの終了まで待ち、ライブラリの移動と競合しない', async () => {
  const job = inspectLibraryIntegrity('test.db', 'library');
  let finished = false;
  void job.then(() => {
    finished = true;
  });
  const worker = state.workers[0];
  worker.emit('message', { dbOk: true, orphanCount: 2, missingCount: 3 });
  await Promise.resolve();
  expect(finished).toBe(false);
  worker.emit('exit', 0);
  await expect(job).resolves.toEqual({ dbOk: true, orphanCount: 2, missingCount: 3 });
});

test('スレッドの例外と結果を返さない終了を成功にしない', async () => {
  const crashed = inspectLibraryIntegrity('test.db', 'library');
  const assertion = expect(crashed).rejects.toThrow('cannot read');
  state.workers[0].emit('error', new Error('cannot read'));
  state.workers[0].emit('exit', 1);
  await assertion;
  const empty = inspectLibraryIntegrity('test.db', 'library');
  state.workers[1].emit('exit', 0);
  await expect(empty).rejects.toThrow('without a result');
});

test('不正な結果ではスレッドを終了させ、検査失敗を返す', async () => {
  const job = inspectLibraryIntegrity('test.db', 'library');
  const assertion = expect(job).rejects.toThrow('Invalid library integrity result');
  state.workers[0].emit('message', { dbOk: true, orphanCount: -1, missingCount: 0 });
  await assertion;
  expect(state.workers[0].terminate).toHaveBeenCalledOnce();
});

test('検査が停止した場合はスレッドを終了させて待機を解除する', async () => {
  vi.useFakeTimers();
  const job = inspectLibraryIntegrity('test.db', 'library');
  const assertion = expect(job).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(120_000);
  await assertion;
  expect(state.workers[0].terminate).toHaveBeenCalledOnce();
});
