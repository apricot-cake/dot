import { CONTENT_SIZE, expect, test } from '../lib/harness.ts';
import { FIXTURE_POSTS } from '../lib/library.ts';

const posts = Array.from({ length: 90 }, (_, index) => ({
  ...FIXTURE_POSTS[index % FIXTURE_POSTS.length],
  captureId: `resize-anchor-${index.toString().padStart(3, '0')}`,
  text: `リサイズ検証${index.toString().padStart(3, '0')}`,
}));

for (const selected of [false, true]) {
  test(`列数が変わっても${selected ? '選択中' : '表示中'}の投稿の縦位置を維持する`, async ({ launchDot }) => {
    const { app, page } = await launchDot({ posts });
    const scroller = page.locator('[data-slot="content-scroll"]');
    await scroller.evaluate((el) => {
      el.scrollTop = 2400;
    });
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(2400);
    await expect
      .poll(() =>
        scroller.evaluate((el) => {
          const bounds = el.getBoundingClientRect();
          return Array.from(el.querySelectorAll('[data-slot="post-card"]')).some((card) => {
            const rect = card.getBoundingClientRect();
            return rect.bottom > bounds.top && rect.top < bounds.bottom && /リサイズ検証\d{3}/.test(card.textContent || '');
          });
        }),
      )
      .toBe(true);
    const anchor = await scroller.evaluate((el) => {
      const bounds = el.getBoundingClientRect();
      const visible = Array.from(el.querySelectorAll<HTMLElement>('[data-slot="post-card"]'))
        .map((card) => ({ card, rect: card.getBoundingClientRect() }))
        .filter(({ rect }) => rect.bottom > bounds.top && rect.top < bounds.bottom)
        .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
      const first = visible[0];
      const text = first?.card.textContent?.match(/リサイズ検証\d{3}/)?.[0];
      if (!first || !text) throw new Error('基準の投稿がありません');
      return { text, y: first.rect.top - bounds.top, width: first.rect.width };
    });
    const card = page.locator('[data-slot="post-grid"] [data-slot="post-card"]').filter({ hasText: anchor.text });
    if (selected) {
      await card.click({ position: { x: 20, y: 20 } });
      await expect(card).toHaveAttribute('data-selected', 'true');
    }
    const before = await card.evaluate((el) => ({ y: el.getBoundingClientRect().top - (el.closest('[data-slot="content-scroll"]')?.getBoundingClientRect().top ?? 0), width: el.getBoundingClientRect().width }));
    for (const width of [CONTENT_SIZE.width + 240, CONTENT_SIZE.width - 200]) {
      await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), { width, height: CONTENT_SIZE.height });
      await expect(card).toBeVisible();
      await expect.poll(() => card.evaluate((el, expectedY) => Math.abs(el.getBoundingClientRect().top - (el.closest('[data-slot="content-scroll"]')?.getBoundingClientRect().top ?? 0) - expectedY), before.y)).toBeLessThan(2);
      expect(await page.locator('[data-slot="post-grid"] [data-slot="post-card"]').count()).toBeLessThan(posts.length);
    }
  });
}
