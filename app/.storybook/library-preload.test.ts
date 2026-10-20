import { afterEach, expect, test, vi } from 'vitest';
import { installLibraryPreload } from './library-preload.ts';
import type { PreviewState } from './library-state.ts';

vi.mock('sonner', () => ({ toast: { info: vi.fn() } }));
afterEach(() => vi.unstubAllGlobals());

test('保存・削除・閲覧記録・自動保存を拒否し、読み取り以外の通信を行わない', async () => {
  const state = { snapshot: { posts: [], profiles: [], saveFolder: 'real-library' }, trash: [], config: { saveFolder: 'real-library', extensionId: null } } as unknown as PreviewState;
  const request = vi.fn(async () => new Response(JSON.stringify(state), { headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', request);
  vi.stubGlobal('window', {});
  await installLibraryPreload();
  expect(await window.dot.listPosts()).toEqual(state.snapshot);
  const results = await Promise.all([
    window.dot.deletePost('existing-post'),
    window.dot.updateTags('existing-post', ['new-tag']),
    window.dot.recordPostView('existing-post'),
    window.dot.setMediaCrop('existing-post', 0, null),
    window.dot.setPref('language', 'en'),
    window.dot.setFolders({ folders: [], activeId: null }),
    window.dot.setTabs({ tabs: [], activeTabId: null }),
    window.dot.appendHistory({ ts: 1, u: '/posts', kind: 'posts', title: '', state: null }),
    window.dot.restorePost('existing-post'),
    window.dot.emptyTrash(),
  ]);
  for (const result of results) expect(result.ok).toBe(false);
  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith('/__dot_preview__/state', { cache: 'no-store' });
  expect(await window.dot.listPosts()).toEqual(state.snapshot);
});

test('実ライブラリが読めなければ、代替データを表示せず失敗する', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('', { status: 500 })),
  );
  vi.stubGlobal('window', {});
  await expect(installLibraryPreload()).rejects.toThrow('ライブラリのプレビューを読み込めませんでした');
  expect(window.dot).toBeUndefined();
});
