import type { Page } from '@playwright/test';
import { expect, test } from '../lib/harness.ts';

async function openFontInput(page: Page) {
  // OS に入っているフォントの数や名前ではなく、入力の確定経路を検証する。
  await page.addInitScript(() => {
    Object.defineProperty(window, 'queryLocalFonts', {
      configurable: true,
      value: async () => [{ family: 'E2E Sans' }, { family: 'E2E Serif' }],
    });
  });
  await page.reload();
  await page.getByRole('button', { name: '設定', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '設定', exact: true });
  await settings.getByRole('button', { name: '外観', exact: true }).click();
  const input = page.locator('#settings-font');
  await expect(input).toBeVisible();
  return { input, settings };
}

const savedFont = (page: Page) => page.evaluate(async () => (await window.dot.getPrefs()).uiFontFamily ?? '');

test('自由入力はEnterで確定し、未確定の編集はEscで直前のフォントへ戻せる', async ({ launchDot }) => {
  const { page } = await launchDot({ posts: [] });
  const { input, settings } = await openFontInput(page);
  await input.fill('E2E Custom Font');
  await expect.poll(() => savedFont(page)).toBe('');
  await input.press('Enter');
  await expect.poll(() => savedFont(page)).toBe('E2E Custom Font');

  await input.fill('E2E Uncommitted Font');
  await expect(page.locator('[data-slot="autocomplete-content"]')).toBeVisible();
  await input.press('Escape');
  await expect(input).toHaveValue('E2E Custom Font');
  await expect(settings).toBeVisible();
  await expect.poll(() => savedFont(page)).toBe('E2E Custom Font');
});

test('フォント候補をキーボードで確定でき、クリアすると既定のフォントへ戻る', async ({ launchDot }) => {
  const { page } = await launchDot({ posts: [] });
  const { input, settings } = await openFontInput(page);
  await input.fill('E2E San');
  await expect(page.getByRole('option', { name: 'E2E Sans', exact: true })).toBeVisible();
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(input).toHaveValue('E2E Sans');
  await expect.poll(() => savedFont(page)).toBe('E2E Sans');

  await settings.locator('[data-slot="autocomplete-clear"]').click();
  await expect(input).toHaveValue('');
  await expect.poll(() => savedFont(page)).toBe('');
  await expect(input).toBeFocused();
});

test('IME変換中のEnterとEscはフォントを確定・取消しない', async ({ launchDot }) => {
  const { page } = await launchDot({ posts: [] });
  const { input, settings } = await openFontInput(page);
  await input.fill('E2E Saved Font');
  await input.press('Enter');
  await expect.poll(() => savedFont(page)).toBe('E2E Saved Font');
  await input.fill('E2E Composition Font');

  for (const key of ['Enter', 'Escape']) {
    await input.dispatchEvent('keydown', { key, code: key, keyCode: 229, which: 229, isComposing: true, bubbles: true });
    await expect(input).toHaveValue('E2E Composition Font');
    await expect(settings).toBeVisible();
    await expect.poll(() => savedFont(page)).toBe('E2E Saved Font');
  }
  await input.press('Enter');
  await expect.poll(() => savedFont(page)).toBe('E2E Composition Font');
});
