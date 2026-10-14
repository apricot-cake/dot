import { expect, test } from '../lib/harness.ts';
import { FIXTURE_POSTS } from '../lib/library.ts';

test('閲覧と編集を切り替え、保存とキャンセルを区別する', async ({ launchDot }) => {
  const dot = await launchDot();
  const { page } = dot;
  await page.locator('[data-slot="post-card"]').filter({ hasText: '猫が机の上で寝ている' }).dblclick();
  const toolbar = page.locator('[data-slot="viewer-toolbar"]');
  await expect(toolbar).toBeVisible();
  await expect(page.locator('[data-slot="image-tab-info"]')).toHaveCount(0);
  await expect(page.locator('[data-slot="inspector-toggle"]')).toBeVisible();
  await expect(toolbar.locator('button')).toHaveCount(3);
  const editButton = page.locator('[data-slot="viewer-edit"]');
  await expect(editButton).toHaveCSS('border-top-width', '1px');
  await expect(editButton).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const edits = () => dot.readDb((db) => db.prepare('SELECT rotation,flipped,cropX FROM media ORDER BY postId,seq').all());
  const before = edits();
  const detail = await page.locator('[data-slot="inspector-toggle"]').boundingBox();
  const tools = await toolbar.boundingBox();
  if (!tools || !detail) throw new Error('ツールバーが表示されていません');
  expect(tools.x + tools.width).toBeLessThan(detail.x);
  const editBounds = await editButton.boundingBox();
  if (!editBounds) throw new Error('編集ボタンが表示されていません');
  expect(editBounds.x).toBeGreaterThan(tools.x + tools.width);
  expect(detail.x - editBounds.x - editBounds.width).toBeCloseTo(6, 0);
  await expect(page.locator('[data-slot="image-tab-stage"] [data-slot="image-tab-crop"]')).toHaveCount(0);
  await editButton.click();
  await expect(editButton).toHaveCount(0);
  const actions = await page.locator('[data-slot="viewer-edit-actions"]').boundingBox();
  if (!actions) throw new Error('編集操作が表示されていません');
  expect(detail.x - actions.x - actions.width).toBeCloseTo(6, 0);
  await expect(page.locator('[data-slot="image-editor"]')).toBeVisible();
  await toolbar.locator('[data-slot="viewer-rotate"]').click();
  await expect(toolbar.locator('[data-slot="viewer-flip"]')).toBeEnabled();
  await toolbar.locator('[data-slot="viewer-flip"]').click();
  await toolbar.locator('[data-slot="image-tab-crop"]').click();
  await expect(page.locator('[data-slot="crop-selection"]')).toBeAttached();
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
  await expect(page.locator('[data-slot="crop-selection"]')).toHaveCount(0);
  expect(edits()).toEqual(before);
  await expect(toolbar.locator('[data-slot="viewer-grid"], [data-slot="viewer-grayscale"]')).toHaveCount(0);
  const fit = toolbar.locator('[data-slot="viewer-fit-toggle"]');
  await expect(fit).toHaveAccessibleName(/ウィンドウ/);
  const level = toolbar.locator('[data-slot="viewer-zoom-level"]');
  await expect(level).not.toHaveText('—');
  const initial = (await level.textContent()) ?? '';
  await toolbar.locator('[data-slot="viewer-zoom-in"]').click();
  await expect(level).not.toHaveText(initial);
  await fit.click();
  await expect(level).toHaveText(initial);
  await fit.click();
  await page.waitForTimeout(250);
  await expect(level).toHaveText(initial);
  await editButton.click();
  await toolbar.locator('[data-slot="viewer-rotate"]').click();
  await toolbar.locator('[data-slot="viewer-flip"]').click();
  await toolbar.locator('[data-slot="image-tab-crop"]').click();
  const handle = page.locator('.ReactCrop__drag-handle.ord-se');
  const bounds = await handle.boundingBox();
  if (!bounds) throw new Error('クロップのハンドルがありません');
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x - 25, bounds.y - 25, { steps: 4 });
  await page.mouse.up();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('[data-slot="image-editor"]')).toHaveCount(0);
  expect(edits().some((row: any) => row.rotation === 90 && row.flipped === 1)).toBe(true);
  expect(edits().some((row: any) => row.cropX != null)).toBe(true);
  await page.reload();
  await expect(editButton).toBeEnabled();
  await editButton.click();
  await expect(toolbar.locator('[data-slot="viewer-flip"]')).toHaveAttribute('aria-pressed', 'true');
  await toolbar.locator('[data-slot="viewer-reset-edits"]').click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('[data-slot="image-editor"]')).toHaveCount(0);
  expect(edits()).toEqual(before);
});
for (const [shape, width, height] of [
  ['縦長', 1200, 2400],
  ['横長', 2400, 1200],
] as const) {
  test(`${shape}画像を初期表示と領域変更後に全体表示する`, async ({ launchDot }) => {
    const dot = await launchDot({ posts: [{ ...FIXTURE_POSTS[0], width, height }] });
    const { page } = dot;
    await page.locator('[data-slot="post-card"]').first().dblclick();
    const image = page.locator('[data-slot="viewer-image"]');
    const level = page.locator('[data-slot="viewer-zoom-level"]');
    const contained = async () =>
      image.evaluate((img) => {
        const wrapper = img.closest('[data-slot="viewer-zoom-wrapper"]');
        if (!wrapper || !(img instanceof HTMLImageElement) || !img.naturalWidth) return false;
        const bounds = wrapper.getBoundingClientRect(),
          frame = img.getBoundingClientRect();
        return frame.width > 0 && frame.height > 0 && frame.left >= bounds.left - 1 && frame.top >= bounds.top - 1 && frame.right <= bounds.right + 1 && frame.bottom <= bounds.bottom + 1;
      });
    await expect(level).toHaveText(/^\d+%$/);
    await expect.poll(contained).toBe(true);
    for (const viewport of [
      { width: 960, height: 800 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await expect.poll(contained).toBe(true);
      await page.locator('[data-slot="inspector-toggle"]').click();
      await expect.poll(contained).toBe(true);
    }
    await page.locator('[data-slot="viewer-zoom-in"]').click();
    await expect(level).toHaveText(/\d+%/);
    await expect
      .poll(async () => {
        const percent = await image.evaluate((img) => {
          const image = img as HTMLImageElement;
          return Math.round((image.getBoundingClientRect().width * 100) / image.naturalWidth);
        });
        return level.textContent().then((text) => text === `${percent}%`);
      })
      .toBe(true);
    const imageBounds = await image.boundingBox();
    if (!imageBounds) throw new Error('画像が表示されていません');
    const cursor = { x: imageBounds.x + imageBounds.width * 0.6, y: imageBounds.y + imageBounds.height * 0.4 };
    await page.mouse.move(cursor.x, cursor.y);
    for (let pulse = 0; pulse < 3; pulse++) {
      await page.mouse.wheel(0, -100);
      await page.waitForTimeout(70);
    }
    await expect(image).toHaveCSS('transition-duration', '0.3s');
    await expect
      .poll(async () =>
        image.evaluate((img, point) => {
          const rect = img.getBoundingClientRect();
          return Math.abs((point.x - rect.left) / rect.width - 0.6) < 0.003 && Math.abs((point.y - rect.top) / rect.height - 0.4) < 0.003;
        }, cursor),
      )
      .toBe(true);
    await page.locator('[data-slot="viewer-fit-toggle"]').click();
    await expect(level).toHaveText(/^\d+%$/);
    await expect.poll(contained).toBe(true);
  });
}
