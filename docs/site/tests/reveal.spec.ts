import { test, expect } from '@playwright/test';

for (const selector of ['#demo', '.feature-section', '.local-section', '.setup-section']) {
  test(selector + 'は画面に入ってからフェードインし、表示後は消えない', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 500 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('./');
    await page.evaluate(() => (document.documentElement.style.scrollBehavior = 'auto'));
    const section = page.locator(selector).first();
    await section.evaluate((element) => window.scrollTo(0, window.scrollY + element.getBoundingClientRect().top - window.innerHeight + 160));
    await expect(section).toHaveAttribute('data-reveal', 'visible');
    await expect
      .poll(async () =>
        section.evaluate((element) => {
          const opacity = Number(getComputedStyle(element).opacity);
          return opacity > 0 && opacity < 1;
        }),
      )
      .toBe(true);
    await expect(section).toHaveCSS('opacity', '1');
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(section).toHaveAttribute('data-reveal', 'visible');
    await expect(section).toHaveCSS('opacity', '1');
  });
}

test('ヒーローを含む全セクションがモーション対象になる', async ({ page }) => {
  await page.goto('./');
  const sections = page.locator('main > section');
  await expect(sections).not.toHaveCount(0);
  for (const section of await sections.all()) await expect(section).toHaveClass(/scroll-reveal/);
});

test('モーションを減らす設定では最初から静的に表示する', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  for (const section of await page.locator('.scroll-reveal').all()) {
    await expect(section).toHaveCSS('opacity', '1');
    await expect(section).toHaveCSS('transition-duration', '0s');
  }
});

test('JavaScriptが無効でも内容を隠さない', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4330/dot/');
  for (const section of await page.locator('.scroll-reveal').all()) await expect(section).toHaveCSS('opacity', '1');
  await context.close();
});
