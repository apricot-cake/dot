import { expect, test } from '../lib/harness.ts';

test('画像とタブのピン留め操作を表示しない', async ({ launchDot }) => {
  const { page } = await launchDot();
  expect(await page.evaluate(() => 'pinSend' in window.dot)).toBe(false);
  const card = page.locator('[data-slot="post-card"]').filter({ hasText: '猫が机の上で寝ている' });
  await card.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: /ピン/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await card.dblclick();
  await expect(page.locator('[data-slot="image-tab-view"]')).toBeVisible();
  await expect(page.locator('[data-slot="viewer-pin"]')).toHaveCount(0);
  await page.getByRole('tab').first().click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: '複製', exact: false })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /ピン/ })).toHaveCount(0);
});
