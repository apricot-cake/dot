import type { Locator } from '@playwright/test';
import { expect, test } from '../lib/harness.ts';
import { FIXTURE_POSTS } from '../lib/library.ts';

async function expectInsideViewport(card: Locator, scroller: Locator) {
  await expect(card).toHaveAttribute('data-selected', 'true');
  await expect
    .poll(async () => {
      const bounds = await card.boundingBox();
      const viewport = await scroller.boundingBox();
      return !!bounds && !!viewport && bounds.y >= viewport.y - 2 && bounds.y + bounds.height <= viewport.y + viewport.height + 2;
    })
    .toBe(true);
}

test('矢印で行方向へ選択を移し、HomeとEndで画面外の投稿を表示する', async ({ launchDot }) => {
  const posts = Array.from({ length: 90 }, (_, i) => ({
    ...FIXTURE_POSTS[i % FIXTURE_POSTS.length],
    captureId: `keyboard-grid-${i.toString().padStart(3, '0')}`,
    text: `キーボード移動検証 ${i}`,
  }));
  const { page } = await launchDot({ posts });
  const scroller = page.locator('[data-slot="content-scroll"]');
  const grid = page.locator('[data-slot="post-grid"]').getByRole('grid');
  const first = grid.locator('[role="gridcell"][data-index="0"] [data-slot="post-card"]');
  const last = grid.locator('[role="gridcell"][data-index="89"] [data-slot="post-card"]');
  await first.click();
  await expect(first).toHaveAttribute('data-selected', 'true');
  const columns = await grid.getByRole('gridcell').evaluateAll((cells) => new Set(cells.map((cell) => (cell as HTMLElement).offsetLeft)).size);
  expect(columns).toBeGreaterThan(1);
  const firstTop = (await first.boundingBox())?.y;
  if (firstTop == null) throw new Error('先頭の投稿が表示されていません');
  await grid.focus();
  await page.keyboard.press('ArrowDown');
  const nextRow = grid.locator(`[role="gridcell"][data-index="${columns}"] [data-slot="post-card"]`);
  await expect(nextRow).toHaveAttribute('data-selected', 'true');
  await expect.poll(async () => (await nextRow.boundingBox())?.y ?? 0).toBeGreaterThan(firstTop);
  await expectInsideViewport(nextRow, scroller);

  await expect(last).toHaveCount(0);
  await page.keyboard.press('End');
  await expectInsideViewport(last, scroller);
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await page.keyboard.press('Home');
  await expectInsideViewport(first, scroller);
  await expect(first).toHaveAttribute('data-selected', 'true');
});
