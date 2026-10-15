import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../lib/harness.ts';
import { FIXTURE_POSTS } from '../lib/library.ts';

const posts = Array.from({ length: 120 }, (_, i) => ({
  ...FIXTURE_POSTS[i % FIXTURE_POSTS.length],
  captureId: `restoration-${i.toString().padStart(3, '0')}`,
  text: `${i % 2 === 0 ? '青い空' : '夕暮れ'} 復元検証${i.toString().padStart(3, '0')}`,
  tags: i % 3 === 0 ? [] : ['風景'],
}));

const searchOf = (page: Page) => page.getByRole('combobox', { name: 'ライブラリ内を検索', exact: true });
const scrollerOf = (page: Page) => page.locator('[data-slot="content-scroll"]');

async function expectScroll(scroller: Locator, top: number) {
  await expect.poll(() => scroller.evaluate((el, expected) => Math.abs(el.scrollTop - expected), top)).toBeLessThan(2);
}

type ViewAnchor = { text: string; y: number };
async function readAnchor(scroller: Locator, fullyVisible = false): Promise<ViewAnchor> {
  const read = () =>
    scroller.evaluate((el, fullyVisible) => {
      const bounds = el.getBoundingClientRect();
      const candidates = [...el.querySelectorAll<HTMLElement>('[data-slot="post-card"]')].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top || Number(a.closest('[data-index]')?.getAttribute('data-index')) - Number(b.closest('[data-index]')?.getAttribute('data-index')));
      for (const card of candidates) {
        const rect = card.getBoundingClientRect();
        const text = card.textContent?.match(/復元検証\d{3}/)?.[0];
        if (text && (fullyVisible ? rect.top >= bounds.top + 20 && rect.top + 100 < bounds.bottom : rect.top < bounds.bottom && rect.bottom > bounds.top)) return { text, y: rect.top - bounds.top };
      }
      return null;
    }, fullyVisible);
  await expect.poll(read).not.toBeNull();
  const anchor = await read();
  if (!anchor) throw new Error('画面内に復元の基準となる投稿がありません');
  return anchor;
}
async function expectAnchor(page: Page, anchor: ViewAnchor) {
  const card = page.locator('[data-slot="post-card"]').filter({ hasText: anchor.text });
  await expect(card).toBeVisible();
  await expect
    .poll(async () => {
      const cardBounds = await card.boundingBox();
      const scrollBounds = await scrollerOf(page).boundingBox();
      return cardBounds && scrollBounds ? Math.abs(cardBounds.y - scrollBounds.y - anchor.y) : Number.POSITIVE_INFINITY;
    })
    .toBeLessThan(2);
}

async function scrollTo(scroller: Locator, top: number) {
  await expect.poll(() => scroller.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(top);
  await scroller.evaluate((el, value) => {
    el.scrollTop = value;
  }, top);
  await expectScroll(scroller, top);
}

async function searchFor(page: Page, query: string) {
  await searchOf(page).fill(query);
  const cards = page.locator('[data-slot="post-grid"] [data-slot="post-card"]');
  await expect(cards.first()).toContainText(query);
  await expect(cards.filter({ hasText: query === '青い空' ? '夕暮れ' : '青い空' })).toHaveCount(0);
  await page.keyboard.press('Escape');
}

test('別タブの検索・タグ条件・履歴・スクロール位置を混ぜずに復元する', async ({ launchDot }) => {
  const { page } = await launchDot({ posts });
  await page.evaluate(() => window.dot.searchFullText('青い空'));
  const scroller = scrollerOf(page);
  const tabs = page.locator('[data-slot="tab"]');
  const chips = page.locator('[data-slot="filter-chip"]');
  await searchFor(page, '青い空');
  await page.getByRole('button', { name: 'フィルタ', exact: true }).click();
  const tags = page.getByRole('menuitem', { name: 'タグ', exact: true });
  await tags.focus();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('searchbox', { name: 'すべてのグループからタグを検索' }).fill('風景');
  await page.getByRole('menuitemcheckbox', { name: /風景/ }).click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(chips).toContainText(['風景']);
  await scrollTo(scroller, 800);
  const firstAnchor = await readAnchor(scroller);

  await page.locator('[data-slot="tab-new"]').click();
  await expect(tabs).toHaveCount(2);
  await searchFor(page, '夕暮れ');
  await expect(chips).toHaveCount(0);
  await scrollTo(scroller, 1400);
  const secondAnchor = await readAnchor(scroller);

  await tabs.nth(0).click();
  await expect(searchOf(page)).toHaveValue('青い空');
  await expect(chips).toContainText(['風景']);
  await expectAnchor(page, firstAnchor);
  await page.getByRole('button', { name: '戻る', exact: true }).click();
  await expect(searchOf(page)).toHaveValue('青い空');
  await expect(chips).toHaveCount(0);
  await page.getByRole('button', { name: '進む', exact: true }).click();
  await expect(chips).toContainText(['風景']);
  await expectAnchor(page, firstAnchor);

  await tabs.nth(1).click();
  await expect(searchOf(page)).toHaveValue('夕暮れ');
  await expect(chips).toHaveCount(0);
  await expectAnchor(page, secondAnchor);
  await page.getByRole('button', { name: '戻る', exact: true }).click();
  await expect(searchOf(page)).toHaveValue('');
  await page.getByRole('button', { name: '進む', exact: true }).click();
  await expect(searchOf(page)).toHaveValue('夕暮れ');
  await expectAnchor(page, secondAnchor);
});

test('深い一覧から画像を開いて戻ると同じ投稿を画面内の同じ位置へ復元する', async ({ launchDot }) => {
  const { page } = await launchDot({ posts });
  const scroller = scrollerOf(page);
  await scrollTo(scroller, 2400);
  const anchor = await readAnchor(scroller, true);
  const card = page.locator('[data-slot="post-card"]').filter({ hasText: anchor.text });
  await card.dblclick({ position: { x: 20, y: 30 } });
  await expect(page.locator('[data-slot="image-tab-view"]')).toBeVisible();
  for (let round = 0; round < 2; round++) {
    await page.getByRole('button', { name: '戻る', exact: true }).click();
    await expect(scroller).toBeVisible();
    await expectAnchor(page, anchor);
    if (round === 0) {
      await page.getByRole('button', { name: '進む', exact: true }).click();
      await expect(page.locator('[data-slot="image-tab-view"]')).toBeVisible();
    }
  }
});

test('実プロセスを再起動しても2タブの検索・履歴・スクロール位置を復元する', async ({ launchDot }) => {
  const dot = await launchDot({ posts });
  let page = dot.page;
  await page.evaluate(() => window.dot.searchFullText('青い空'));
  await searchFor(page, '青い空');
  await scrollTo(scrollerOf(page), 800);
  const firstAnchor = await readAnchor(scrollerOf(page));
  await page.locator('[data-slot="tab-new"]').click();
  await searchFor(page, '夕暮れ');
  await scrollTo(scrollerOf(page), 1400);
  const secondAnchor = await readAnchor(scrollerOf(page));
  await page.locator('[data-slot="tab"]').nth(0).click();
  await expect(searchOf(page)).toHaveValue('青い空');
  await expectAnchor(page, firstAnchor);
  const firstSavedTop = await scrollerOf(page).evaluate((el) => el.scrollTop);

  // IPC の getTabs は保存済みの SQLite を読む。デバウンスの固定時間ではなく、
  // 2タブの履歴と位置が実際に永続化されたことを確認してからプロセスを終了する。
  await expect
    .poll(async () =>
      page.evaluate(async (expectedTop) => {
        const saved = await window.dot.getTabs();
        if (!saved || saved.tabs.length !== 2) return false;
        const [first, second] = saved.tabs;
        return (
          saved.activeTabId === first.id &&
          first.state?.view?.search === '青い空' &&
          second.state?.view?.search === '夕暮れ' &&
          Math.abs((first.state?.scrollTop ?? -1) - expectedTop) < 2 &&
          Math.abs((second.state?.scrollTop ?? -1) - 1400) < 2 &&
          (first.state?.nav?.hist.length ?? 0) >= 2 &&
          (second.state?.nav?.hist.length ?? 0) >= 2
        );
      }, firstSavedTop),
    )
    .toBe(true);

  await dot.restart();
  page = dot.page;
  const tabs = page.locator('[data-slot="tab"]');
  await expect(tabs).toHaveCount(2);
  await expect(tabs.nth(0)).toHaveAttribute('data-active', 'true');
  for (const [index, query, anchor] of [
    [0, '青い空', firstAnchor],
    [1, '夕暮れ', secondAnchor],
  ] as const) {
    await tabs.nth(index).click();
    await expect(searchOf(page)).toHaveValue(query);
    await expectAnchor(page, anchor);
    await page.getByRole('button', { name: '戻る', exact: true }).click();
    await expect(searchOf(page)).toHaveValue('');
    await page.getByRole('button', { name: '進む', exact: true }).click();
    await expect(searchOf(page)).toHaveValue(query);
    await expectAnchor(page, anchor);
  }
});
