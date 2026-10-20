// インスペクタでのタグのインライン編集（刷新 P2⑦）をDBまで通しで検証する。
// SMOKEハーネスではなくここで駆動する理由は往復にある＝ポインタとキーボードで
// 欄に入れた値が、アプリを再起動した後にSQLiteから読み出した値と一致することを確かめる。
import { expect, test } from '../lib/harness.ts';

test('キャラから作品を付与し、チップから外せる', async ({ launchDot }) => {
  const dot = await launchDot();
  const { page } = dot;
  await page.evaluate(async () => {
    const workId = await window.dot.saveClassifiedTag({ name: 'テスト作品', category: 'work', workId: null });
    await window.dot.saveClassifiedTag({ name: 'テストキャラ', category: 'character', workId });
    await window.dot.saveClassifiedTag({ name: '別のキャラ', category: 'character', workId });
  });
  await page.locator('[data-slot="post-grid"] [data-slot="post-card"]').filter({ hasText: '猫が机の上で寝ている' }).click();
  await page.locator('[data-slot="inspector"]').getByRole('tab', { name: 'タグ', exact: true }).click();
  const tags = page.locator('[data-slot="inspector-tags"]');
  await tags.getByRole('combobox', { name: 'キャラ', exact: true }).click();
  await page.getByRole('option').filter({ hasText: 'テストキャラ' }).click();
  await expect.poll(() => dot.tagsOf('e2e-0003')).toEqual(expect.arrayContaining(['テスト作品', 'テストキャラ']));
  const popup = page.locator('[data-slot="combobox-content"]');
  await expect(popup.getByRole('option').filter({ hasText: 'テストキャラ' })).toHaveAttribute('aria-selected', 'true');
  await popup.getByRole('combobox', { name: 'キャラ', exact: true }).fill('別の');
  await expect(popup.getByRole('option')).toHaveCount(1);
  await popup.getByRole('option').filter({ hasText: '別のキャラ' }).click();
  await expect.poll(() => dot.tagsOf('e2e-0003')).toEqual(expect.arrayContaining(['テスト作品', 'テストキャラ', '別のキャラ']));
  await expect(popup.getByRole('option').filter({ hasText: '別のキャラ' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(tags.getByRole('combobox', { name: '作品', exact: true })).toHaveText('テスト作品');
  await tags.getByRole('button', { name: 'テストキャラを外す', exact: true }).click();
  await expect.poll(() => dot.tagsOf('e2e-0003')).toEqual(expect.arrayContaining(['テスト作品', '別のキャラ']));
  await expect(tags.getByRole('button', { name: 'テストキャラを外す', exact: true })).toHaveCount(0);
  await tags.getByRole('button', { name: '別のキャラを外す', exact: true }).click();
  await expect.poll(() => dot.tagsOf('e2e-0003')).toEqual([]);
});

test('検索で作品なしキャラを新規作成し、付与を開き直せる', async ({ launchDot }) => {
  const dot = await launchDot();
  const { page } = dot;
  await page.locator('[data-slot="post-grid"] [data-slot="post-card"]').filter({ hasText: '猫が机の上で寝ている' }).click();
  await page.locator('[data-slot="inspector"]').getByRole('tab', { name: 'タグ', exact: true }).click();
  const tags = page.locator('[data-slot="inspector-tags"]');
  await tags.getByRole('combobox', { name: 'キャラ', exact: true }).click();
  await page.locator('[data-slot="combobox-content"]').getByRole('combobox', { name: 'キャラ', exact: true }).fill('テストOC');
  await page.getByRole('option', { name: '「テストOC」を作成', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('combobox', { name: '作品', exact: true })).toHaveValue('作品なし');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(tags.getByRole('button', { name: 'テストOCを外す', exact: true })).toBeVisible();
  await expect.poll(() => dot.tagsOf('e2e-0003')).toEqual(['テストOC']);
  await page.reload();
  await page.locator('[data-slot="post-grid"] [data-slot="post-card"]').filter({ hasText: '猫が机の上で寝ている' }).click();
  await page.locator('[data-slot="inspector"]').getByRole('tab', { name: 'タグ', exact: true }).click();
  await expect(tags.getByRole('button', { name: 'テストOCを外す', exact: true })).toBeVisible();
});

test('作品の検索と単一選択、右クリック編集、分類管理の選択欄が連動する', async ({ launchDot }) => {
  const dot = await launchDot();
  const { page } = dot;
  await page.evaluate(async () => {
    const workId = await window.dot.saveClassifiedTag({ name: '検索対象の作品', category: 'work', workId: null });
    await window.dot.saveClassifiedTag({ name: '別作品', category: 'work', workId: null });
    await window.dot.saveClassifiedTag({ name: '所属キャラ', category: 'character', workId });
  });
  await page.locator('[data-slot="post-grid"] [data-slot="post-card"]').filter({ hasText: '猫が机の上で寝ている' }).click();
  await page.locator('[data-slot="inspector"]').getByRole('tab', { name: 'タグ', exact: true }).click();
  const tags = page.locator('[data-slot="inspector-tags"]');
  const work = tags.getByRole('combobox', { name: '作品', exact: true });
  await work.click();
  const popup = page.locator('[data-slot="combobox-content"]');
  await popup.getByRole('combobox', { name: '作品', exact: true }).fill('検索対象');
  await expect(popup.getByRole('option')).toHaveCount(1);
  await popup.getByRole('option', { name: '検索対象の作品', exact: true }).click();
  await expect(popup).toHaveCount(0);
  await expect(work).toHaveText('検索対象の作品');
  await expect.poll(() => dot.tagsOf('e2e-0003')).toEqual(['検索対象の作品']);
  await work.click();
  await popup.getByRole('option', { name: '検索対象の作品', exact: true }).click({ button: 'right' });
  const dialog = page.getByRole('dialog', { name: 'タグを分類', exact: true });
  await expect(dialog.getByRole('textbox', { name: 'タグ名', exact: true })).toHaveValue('検索対象の作品');
  await expect(dialog.getByRole('combobox', { name: '種類', exact: true }).locator('[data-slot="select-value"]')).toHaveText('作品');
  const existing = dialog.getByRole('combobox', { name: 'タグ', exact: true });
  await existing.fill('所属');
  await expect(popup.getByRole('option')).toHaveCount(1);
  await popup.getByRole('option', { name: '所属キャラ — 検索対象の作品', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: 'タグ名', exact: true })).toHaveValue('所属キャラ');
  await expect(dialog.getByRole('combobox', { name: '種類', exact: true }).locator('[data-slot="select-value"]')).toHaveText('キャラ');
  const parentWork = dialog.getByRole('combobox', { name: '作品', exact: true });
  await expect(parentWork).toHaveValue('検索対象の作品');
  await parentWork.fill('別作品');
  await popup.getByRole('option', { name: '別作品', exact: true }).click();
  await expect(parentWork).toHaveValue('別作品');
  await dialog.getByRole('combobox', { name: '種類', exact: true }).click();
  await page.getByRole('option', { name: 'その他のタグ', exact: true }).click();
  await expect(dialog.getByRole('combobox', { name: '作品', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'キャンセル', exact: true }).click();
  await expect.poll(() => dot.tagsOf('e2e-0003')).toEqual(['検索対象の作品']);
});

test('インスペクタでタグを足すとチップになり DB に保存される', async ({ launchDot }) => {
  const dot = await launchDot();
  const { page } = dot;

  await page.locator('[data-slot="post-grid"] [data-slot="post-card"]').filter({ hasText: '猫が机の上で寝ている' }).click();
  await page.locator('[data-slot="inspector"]').getByRole('tab', { name: 'タグ', exact: true }).click();
  const tags = page.locator('[data-slot="inspector-tags"]');
  await expect(tags).toBeVisible();

  await tags.locator('[data-slot="tag-input"]').click();
  await page.keyboard.type('ねこ');
  await page.keyboard.press('Enter');

  await expect(tags.locator('[data-slot="tag-chip"]').filter({ hasText: 'ねこ' })).toHaveCount(1);

  // 永続化を検証する。いま操作した画面ではなく、アプリ自身のデータベースから直接読み出す。
  await expect.poll(() => dot.tagsOf('e2e-0003')).toEqual(['ねこ']);
});

test('タグのチップから削除すると DB からも消える', async ({ launchDot }) => {
  const dot = await launchDot();
  const { page } = dot;

  await page.locator('[data-slot="post-grid"] [data-slot="post-card"]').filter({ hasText: '青い空と海の写真です' }).click();
  await page.locator('[data-slot="inspector"]').getByRole('tab', { name: 'タグ', exact: true }).click();
  const tags = page.locator('[data-slot="inspector-tags"]');
  const chip = tags.locator('[data-slot="tag-chip"]').filter({ hasText: '青' });
  await expect(chip).toHaveCount(1);

  await chip.getByRole('button').click();

  await expect(tags.locator('[data-slot="tag-chip"]').filter({ hasText: '青' })).toHaveCount(0);
  await expect.poll(() => dot.tagsOf('e2e-0001')).toEqual(['風景']);
});
