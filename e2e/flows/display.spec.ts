import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '../lib/harness.ts';

test('以前のリスト設定が残っていてもグリッドで表示し、表示設定を変更できる', async ({ launchDot }) => {
  const { page } = await launchDot({
    seed: ({ configDir }) => {
      const file = path.join(configDir, 'config.json');
      const config = JSON.parse(fs.readFileSync(file, 'utf8'));
      fs.writeFileSync(file, JSON.stringify({ ...config, layoutMode: 'list', posterLayoutMode: 'list', listThumb: 160 }));
    },
  });
  const cards = page.locator('[data-slot="post-grid"] [data-slot="post-card"]');
  await expect(cards).toHaveCount(4);
  await expect.poll(() => cards.evaluateAll((items) => new Set(items.map((item) => Math.round(item.getBoundingClientRect().left))).size)).toBeGreaterThan(1);

  await expect(page.getByText('リスト', { exact: true })).toHaveCount(0);
  const size = page.locator('[data-slot="toolbar-card-size"]').getByRole('slider');
  await expect(size).toBeEnabled();
  const before = await size.inputValue();
  await size.press('ArrowRight');
  await expect(size).not.toHaveValue(before);
  await page.keyboard.press('Escape');
  await expect(cards).toHaveCount(4);
});
