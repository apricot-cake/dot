import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const site = fileURLToPath(new URL('../', import.meta.url));
const out = resolve(site, '../../../../media/dot/artifacts/product-page');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await page.goto('http://127.0.0.1:4330/dot/');
  await page.waitForFunction(() => document.querySelector('[data-testid="replay-demo"]')?.getAttribute('data-ready') === 'true');
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(out, 'first-screen.png') });
  await page.screenshot({ path: resolve(out, 'desktop.png'), fullPage: true });
  await page.getByTestId('replay-step-1').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="replay-demo"]')?.getAttribute('data-search-phase') === 'results');
  await page.locator('.dot-demo').screenshot({ path: resolve(out, 'demo-search.png') });
  await page.getByTestId('feature-origin').screenshot({ path: resolve(out, 'feature-origin.png') });
  await page.getByTestId('feature-organize').screenshot({ path: resolve(out, 'feature-organize.png') });
  await page.getByTestId('feature-authors').screenshot({ path: resolve(out, 'feature-authors.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:4330/dot/');
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(out, 'mobile.png'), fullPage: true });
  await page.getByTestId('replay-step-1').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="replay-demo"]')?.getAttribute('data-search-phase') === 'results');
  await page.locator('.dot-demo').screenshot({ path: resolve(out, 'mobile-search.png') });
  await page.getByTestId('feature-authors').screenshot({ path: resolve(out, 'mobile-authors.png') });
  console.log(out);
} finally {
  await browser.close();
}
