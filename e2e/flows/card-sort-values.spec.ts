import { expect, test } from '../lib/harness.ts';

test('カード右下の値がソートに連動し、補足は候補だけに表示される', async ({ launchDot }) => {
  const { page } = await launchDot();
  for (const mode of ['ホーム', '投稿者']) {
    await page.locator('[data-slot="sidebar-menu-button"]').filter({ hasText: mode }).press('Enter');
    const select = page.locator('[data-slot="toolbar-sort"]');
    const slot = mode === 'ホーム' ? 'post-card-sort-value' : 'poster-card-sort-value';
    const options = mode === 'ホーム' ? ['投稿日', '保存日', '閲覧数', '閲覧日', 'いいね数', 'ランダム'] : ['閲覧数', '閲覧日', '投稿数', 'フォロワー数', '日付', '名前', 'ランダム'];
    const menu = page.locator('[data-slot="dropdown-menu-content"]');
    for (const label of options) {
      await expect(menu).toHaveCount(0);
      await select.press('Space');
      await expect(select).toHaveAttribute('aria-expanded', 'true');
      await expect(menu).toBeVisible();
      const option = page.getByRole('menuitemradio', { name: label, exact: true });
      if (label === 'いいね数' || label === 'フォロワー数') {
        await option.hover();
        await expect(page.locator('[data-slot="tooltip-content"][data-open]')).toContainText('サイト内での比較に基づく並び順');
      }
      await option.press('Enter');
      await expect(select).toHaveText(label);
      await expect(option).toHaveAttribute('aria-checked', 'true');
      // ラジオ項目は選択後も開いたままなので、閉じてから次の候補を開く。
      await page.keyboard.press('Escape');
      await expect(select).toHaveAttribute('aria-expanded', 'false');
      await expect(menu).toHaveCount(0);
      const values = page.locator(`[data-slot="${slot}"]`);
      if (label === 'ランダム' || label === '名前') {
        await expect(values).toHaveCount(0);
      } else {
        await expect(values.first()).toBeVisible();
        await expect(values.first()).not.toContainText('%');
        await expect(values.first()).not.toHaveAttribute('title');
        expect(await values.first().locator('[title]').count()).toBe(0);
        const aligned = await values.first().evaluate((el) => {
          const box = el.getBoundingClientRect();
          const parentElement = el.parentElement;
          if (!parentElement) throw new Error('カードのソート値に親要素がありません');
          const parent = parentElement.getBoundingClientRect();
          return Math.abs(parent.right - box.right) < 20;
        });
        expect(aligned).toBe(true);
      }
    }
  }
});
