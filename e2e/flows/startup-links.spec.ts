import { expect, test } from '../lib/harness.ts';

test('非表示で起動済みのアプリでも投稿リンクの画像を開ける', async ({ launchDot }) => {
  const dot = await launchDot();
  const url = 'https://x.com/fixture/status/2100000000000000001';
  dot.readDb((sqlite) => sqlite.prepare('UPDATE posts SET url=?,postKey=? WHERE captureId=?').run(url, 'x:2100000000000000001', 'e2e-0001'));
  await dot.page.reload();
  await expect(dot.page.locator('[data-slot="post-grid"] [data-slot="post-card"]')).toHaveCount(4);
  const link = `dot://post?url=${encodeURIComponent(url)}`;
  try {
    await dot.app.evaluate(({ app, BrowserWindow }, target) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win.isVisible()) throw new Error('検証ウィンドウが非表示ではありません');
      // 通常の起動要求の分岐を通すが、利用者の画面を前面化しない。
      const testWindow = win as typeof win & { originalShow?: typeof win.show; originalFocus?: typeof win.focus };
      testWindow.originalShow = win.show;
      testWindow.originalFocus = win.focus;
      win.show = () => {};
      win.focus = () => {};
      app.emit('second-instance', {}, [app.getAppPath(), target], process.cwd(), {});
    }, link);
    const image = dot.page.locator('[data-slot="viewer-image"]').first();
    await expect(image).toHaveAttribute('src', /e2e-0001/);
    await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    expect(await dot.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(false);
  } finally {
    await dot.app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0] as Electron.BrowserWindow & { originalShow?: () => void; originalFocus?: () => void };
      if (win.originalShow) win.show = win.originalShow;
      if (win.originalFocus) win.focus = win.originalFocus;
      delete win.originalShow;
      delete win.originalFocus;
    });
  }
});
