import { expect, test, vi } from 'vitest';
const { run } = require('./cdp-verify.cts');
test('所有セッション内の評価が例外を呼出し元に返す', async () => {
  const send = vi.fn().mockResolvedValue({ exceptionDetails: { text: 'failure' } });
  await expect(run({ send }, ['eval', '1'])).rejects.toThrow('failure');
});
test.each(['blank', 'timeout'])('撮影失敗時に前面表示やファイル保存をしない: %s', async (kind) => {
  const methods: string[] = [];
  const send = (method: string) => {
    methods.push(method);
    return kind === 'timeout' ? new Promise(() => {}) : Promise.resolve({ data: '' });
  };
  await expect(run({ send }, ['shot'])).rejects.toThrow();
  expect(methods).toEqual(['Page.captureScreenshot']);
});
