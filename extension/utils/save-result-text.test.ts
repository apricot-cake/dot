import { expect, test, vi } from 'vitest';
import { createI18n } from './i18n.ts';
import { saveResultText } from './save-result-text.ts';

test('本文や画像を取得できなくても保存した URL を通知する', async () => {
  vi.stubGlobal('navigator', { language: 'ja-JP' });
  const { getMessage } = await createI18n();
  const text = saveResultText({ ok: true, metaOk: false, metaReason: 'invalidResponse', acquisitionIssues: [{ scope: 'post', reason: 'invalidResponse' }], savedContent: { url: true, text: false, profile: false, media: 0 } }, getMessage);
  expect(text.savedSummary).toBe('URLは保存済み');
  expect(text.failure).toBe('投稿情報を取得できませんでした');
  vi.unstubAllGlobals();
});

test('複数の取得失敗を隠さず、保存できた内容と分けて伝える', async () => {
  vi.stubGlobal('navigator', { language: 'ja-JP' });
  const { getMessage } = await createI18n();
  const text = saveResultText(
    {
      ok: true,
      metaOk: false,
      metaReason: null,
      acquisitionIssues: [
        { scope: 'profile', reason: 'fetchFailed' },
        { scope: 'media', reason: 'invalidResponse' },
      ],
      savedContent: { text: true, profile: false, media: 1 },
    },
    getMessage,
  );
  expect(text.failure).toBe('投稿者情報・画像・動画を取得できませんでした');
  expect(text.savedSummary).toBe('本文・画像・動画 1件は保存済み');
  vi.unstubAllGlobals();
});

test('保存済み内容が不明な応答から全件失敗を断定しない', async () => {
  vi.stubGlobal('navigator', { language: 'ja-JP' });
  const { getMessage } = await createI18n();
  expect(saveResultText({ ok: true, metaOk: false, metaReason: 'fetchFailed' }, getMessage).savedSummary).toBeUndefined();
  vi.unstubAllGlobals();
});
