import { test, expect, type Page } from '@playwright/test';
async function ready(page: Page) {
  await expect(page.getByTestId('replay-demo')).toHaveAttribute('data-ready', 'true');
}
test.beforeEach(async ({ page }) => {
  await page.clock.install();
});

test('工程の選択は先頭から再生し、キーボードでも操作できる', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await ready(page);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  for (const step of [2, 1, 0]) {
    await page.getByTestId('replay-step-' + step).click();
    await expect(page.getByTestId('replay-demo')).toHaveAttribute('data-step', String(step));
    expect(Number(await page.getByTestId('replay-demo').getAttribute('data-elapsed')) - step * 5600).toBeLessThan(200);
  }
  await page.getByTestId('replay-step-2').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('replay-demo')).toHaveAttribute('data-playing', 'false');
  await page.reload();
  await ready(page);
  await expect(page.getByTestId('replay-demo')).toHaveAttribute('data-step', '0');
  expect(errors).toEqual([]);
});

test('自動再生が最後から先頭へループする', async ({ page }) => {
  await page.goto('./');
  await ready(page);
  await page.mouse.move(1, 1);
  await expect(page.getByTestId('replay-demo')).toHaveAttribute('data-playing', 'true');
  await page.clock.runFor(5800);
  await expect(page.getByTestId('replay-demo')).toHaveAttribute('data-step', '1');
  await page.clock.runFor(12000);
  await expect(page.getByTestId('replay-demo')).toHaveAttribute('data-step', '0');
});

test('マウス操作中も再生を続け、キーボード操作中は停止する', async ({ page }) => {
  await page.goto('./');
  await ready(page);
  await page.getByTestId('replay-demo').hover();
  await page.getByTestId('replay-step-0').click();
  await page.clock.runFor(1600);
  await expect(page.getByTestId('replay-demo')).toHaveAttribute('data-step', '0');
  await expect(page.getByTestId('replay-demo')).toHaveAttribute('data-playing', 'true');
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('replay-demo')).toHaveAttribute('data-playing', 'false');
  const elapsed = await page.getByTestId('replay-demo').getAttribute('data-elapsed');
  await page.clock.runFor(1500);
  expect(await page.getByTestId('replay-demo').getAttribute('data-elapsed')).toBe(elapsed);
});

for (const motion of ['no-preference', 'reduce'] as const) {
  test('ひらがな入力から漢字へ変換し、確定後に検索する: ' + motion, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: motion });
    await page.goto('./');
    await ready(page);
    await page.getByTestId('replay-step-1').click();
    await expect(page.getByTestId('replay-query')).toHaveText('');
    await page.clock.runFor(3300);
    await expect(page.getByTestId('replay-query')).toContainText(/^[ぁ-ゔ]+$/);
    await expect(page.getByTestId('replay-results')).toHaveText('3件の投稿');
    await page.clock.runFor(800);
    await expect(page.getByTestId('replay-query')).toHaveText('青雀');
    await expect(page.getByTestId('replay-results')).toHaveText('3件の投稿');
    await page.clock.runFor(700);
    await expect(page.getByTestId('replay-results')).toHaveText('1件の投稿');
    await expect(page.locator('.demo-grid [data-slot="post-card"]')).toContainText('青雀');
    if (motion === 'reduce') await expect(page.locator('.demo-cursor')).toBeHidden();
    else await expect(page.locator('.demo-cursor')).toHaveCSS('opacity', '0');
  });
}

test('投稿を保存すると同じ画像と本文が検索結果に残る', async ({ page }) => {
  await page.goto('./');
  await ready(page);
  const image = await page.locator('.demo-social-post img').getAttribute('src');
  await expect(page.locator('.demo-save-control .lucide-download')).toHaveCount(1);
  await page.clock.runFor(2600);
  await expect(page.locator('.demo-save-toast')).toHaveAttribute('data-state', 'busy');
  await page.clock.runFor(1000);
  await expect(page.locator('.demo-save-toast')).toContainText('1件保存しました');
  await page.getByTestId('replay-step-1').click();
  for (const label of ['いいね', 'リポスト', '返信', 'ブックマーク', '表示数']) await expect(page.getByTestId('replay-engagement').getByRole('group', { name: new RegExp(label + ':') })).toHaveCount(1);
  await page.getByTestId('replay-step-1').click();
  await page.clock.runFor(4800);
  await expect(page.locator('.demo-grid [data-slot="post-card"]')).toHaveCount(1);
  expect(await page.locator('.demo-grid [data-slot="post-card-media"]').getAttribute('src')).toBe(image);
});

test('ヘッダーとバッジ、削除指定を反映する', async ({ page }) => {
  await page.goto('./');
  await ready(page);
  await expect(page.locator('header .header-github')).toHaveAccessibleName('GitHub');
  await expect(page.locator('header .header-github')).toHaveText('');
  await expect(page.locator('header .header-github img')).toHaveCount(1);
  await expect(page.locator('.hero .header-github,.github-button,footer,header nav,.demo-restart,.demo-heading,.demo-caption,.demo-controls,.closing-section')).toHaveCount(0);
  await expect(page.locator('.setup-section h2')).toHaveText('使いはじめる');
  await expect(page.locator('.setup-section h3,.setup-section svg')).toHaveCount(0);
  await expect(page.locator('.local-section')).toContainText('アカウントを作らずに使えます');
  await expect(page.locator('.local-icon .lucide-lock')).toHaveCount(1);
  await expect(page.locator('h1')).toContainText('そのイラスト、');
  await expect(page.locator('.store-button img')).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'Microsoft Store', exact: true })).toHaveCount(2);
  for (const button of await page.locator('.store-button').all()) await expect(button).toBeDisabled();
  expect(
    await page.locator('.store-button img').evaluateAll((images) =>
      images.every((image) => {
        const img = image as HTMLImageElement;
        const rect = img.getBoundingClientRect();
        return img.complete && img.naturalWidth > 0 && Math.abs(rect.width / rect.height - img.naturalWidth / img.naturalHeight) < 0.01 && getComputedStyle(img).filter === 'none';
      }),
    ),
  ).toBe(true);
});

test('説明図を実アプリの構成に合わせ、投稿者とインポートを紹介する', async ({ page }) => {
  await page.goto('./');
  await ready(page);
  await expect(page.getByTestId('feature-origin')).toContainText('元URL');
  await expect(page.getByTestId('feature-organize')).toContainText('作品');
  await expect(page.getByTestId('feature-organize')).toContainText('キャラ');
  await expect(page.locator('.feature-reverse .feature-copy')).toContainText('手元のイラストもインポート');
  await expect(page.locator('.organize-results [data-selected]')).toHaveCount(0);
  for (const name of ['あんず', 'みずたま', 'こもれび']) await expect(page.locator('.authors-list')).toContainText(name);
  await expect(page.getByTestId('feature-authors').locator('img')).toHaveCount(3);
});

for (const width of [320, 390, 430, 640, 650, 665, 768, 800, 900, 1024, 1280, 1625]) {
  test(width + 'pxでページと全工程が幅に収まる', async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('./');
    await ready(page);
    for (const step of [0, 1, 2]) {
      await page.getByTestId('replay-step-' + step).click();
      await page.clock.runFor(3300);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    for (const id of ['feature-origin', 'feature-organize', 'feature-authors']) await page.getByTestId(id).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(
      await page.locator('.brand').evaluate((brand) => {
        const image = brand.querySelector('img'),
          name = brand.querySelector('.brand-name');
        if (!image || !name) return false;
        const a = image.getBoundingClientRect(),
          b = name.getBoundingClientRect();
        return Math.abs(a.top + a.height / 2 - b.top - b.height / 2) < 1;
      }),
    ).toBe(true);
  });
}

test('内部リンクは有効で、外部へ通信しない', async ({ page, request }) => {
  const external: string[] = [];
  page.on('request', (req) => {
    if (!req.url().startsWith('http://127.0.0.1:4330') && !req.url().startsWith('data:')) external.push(req.url());
  });
  for (const path of ['./', 'privacy/']) {
    await page.goto(path);
    await expect(page.locator('h1')).toBeVisible();
    const links = await page.locator('a[href]').evaluateAll((a) => a.map((el) => (el as HTMLAnchorElement).href));
    for (const url of new Set(links.filter((url) => url.startsWith('http://127.0.0.1:4330/dot/')))) expect((await request.get(url.split('#')[0])).status()).toBe(200);
  }
  expect(external).toEqual([]);
});

for (const width of [390, 1625]) {
  test(width + 'pxでフィルタとソートを開閉しても結果と並び順を変えない', async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('./');
    await ready(page);
    await page.getByTestId('replay-step-2').click();
    const demo = page.getByTestId('replay-demo');
    await expect(page.locator('.demo-step')).toHaveText(['ワンクリックで保存', '投稿情報から検索', 'フィルタとソート']);
    const assertUnchanged = async () => {
      await expect(demo).toHaveAttribute('data-applied-query', '青雀');
      await expect(page.getByTestId('replay-results')).toHaveText('1件の投稿');
      await expect(page.locator('.demo-sort')).toContainText('投稿日');
      await expect(page.locator('.demo-card-wrap')).toHaveAttribute('data-post-id', 'qingque');
    };
    await page.clock.runFor(1100);
    await expect(demo).toHaveAttribute('data-menu-phase', 'filter-open');
    await expect(page.getByTestId('replay-menu')).toContainText('ハッシュタグ');
    await assertUnchanged();
    await page.clock.runFor(1600);
    await expect(page.getByTestId('replay-menu')).toHaveCount(0);
    await assertUnchanged();
    await page.clock.runFor(1000);
    await expect(demo).toHaveAttribute('data-menu-phase', 'sort-open');
    await expect(page.getByTestId('replay-menu')).toContainText('新しい順');
    const withinScreen = await page.getByTestId('replay-menu').evaluate((menu) => {
      const panel = menu.getBoundingClientRect();
      const screen = menu.closest('.demo-screen')!.getBoundingClientRect();
      return panel.left >= screen.left && panel.right <= screen.right && panel.bottom <= screen.bottom;
    });
    expect(withinScreen).toBe(true);
    await assertUnchanged();
    await page.clock.runFor(1500);
    await expect(demo).toHaveAttribute('data-menu-phase', 'closed');
    await expect(page.getByTestId('replay-menu')).toHaveCount(0);
    await assertUnchanged();
  });
}

for (const width of [390, 1625]) {
  test(width + 'pxでカーソルの到着後にメニューを開閉する', async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('./');
    await ready(page);
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    await page.getByTestId('replay-step-2').click();
    const demo = page.getByTestId('replay-demo');
    const assertOnTarget = async (name: string) => {
      await expect(demo).toHaveAttribute('data-cursor-target', name);
      expect(
        await page.locator('.demo-cursor').evaluate((cursor, targetName) => {
          const target = cursor
            .closest('.demo-screen')!
            .querySelector('[data-demo-target="' + targetName + '"]')!
            .getBoundingClientRect();
          const point = cursor.getBoundingClientRect();
          return Math.abs(point.left - target.left - target.width / 2) < 1 && Math.abs(point.top - target.top - target.height / 2) < 1;
        }, name),
      ).toBe(true);
    };
    await page.clock.runFor(1000);
    await expect(demo).toHaveAttribute('data-menu-phase', 'filter-open');
    await assertOnTarget('filter');
    await page.clock.runFor(1300);
    await expect(page.getByTestId('replay-menu')).toHaveCount(0);
    await assertOnTarget('filter');
    await page.clock.runFor(1000);
    await expect(demo).toHaveAttribute('data-menu-phase', 'sort-open');
    await assertOnTarget('sort');
    await page.clock.runFor(1900);
    await expect(page.getByTestId('replay-menu')).toHaveCount(0);
    await assertOnTarget('sort');
  });
}
