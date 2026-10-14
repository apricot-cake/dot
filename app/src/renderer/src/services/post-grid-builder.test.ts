// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest';
import { makePostGridBuilder, type PostGridBuilderDeps } from './post-grid-builder.ts';
import { store } from './store.ts';
import { resolveLinkedPost } from './post-link.ts';
import type { PostsDelta } from '../../../main/ipc-payloads.ts';
import { postView } from '../../../../../tests/helpers/test-post-view.ts';

const mocks = vi.hoisted(() => ({ delta: vi.fn(), groups: vi.fn(), reconcile: vi.fn(), sync: vi.fn() }));
vi.mock('./posts.ts', () => ({ listPostsDelta: mocks.delta, deletePost: vi.fn(), clearAll: vi.fn() }));
vi.mock('./records.ts', () => ({
  stampPost: (post: unknown) => post,
  loadManualGroups: mocks.groups,
  makeGroupRecords: () => () => [],
  densityImage: vi.fn(),
  postIdKey: vi.fn(),
  makeCardModel: vi.fn(),
  percentileFn: vi.fn(),
}));
vi.mock('./folders.ts', () => ({ reconcile: mocks.reconcile }));
vi.mock('./posts-data.ts', () => ({ sync: mocks.sync, getQuotedPost: vi.fn() }));
vi.mock('./grid.ts', () => ({ dotPostGridSource: { configure: vi.fn() } }));
vi.mock('./trash-view.ts', () => ({ refresh: vi.fn() }));

function createBuilder() {
  const deps = {
    t: (key: string) => key,
    smokeCapture: false,
    getFilteredPosts: vi.fn(() => []),
    snapshotState: () => ({}),
    sortValue: () => 'saved',
    renderPosters: vi.fn(),
    onPostsLoaded: vi.fn(),
    syncTitleAndPersist: vi.fn(),
    selectionMenu: { items: () => [], pick: () => false },
  } as unknown as PostGridBuilderDeps;
  return { grid: makePostGridBuilder(deps), deps };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.groups.mockResolvedValue([]);
  mocks.delta.mockResolvedValue({ full: false, added: [], removed: [], profiles: [] });
  store.setState({ browseMode: 'posts', postQueryTree: null } as any);
});

test('空の差分では全投稿と画像ビューの購読を再構築しない', async () => {
  mocks.delta.mockResolvedValueOnce({ full: true, posts: [{ captureId: 'saved' }], profiles: [] });
  const { grid, deps } = createBuilder();
  await grid.loadPosts();
  const posts = grid.getAllPosts();
  const generation = grid.getGeneration();
  vi.clearAllMocks();
  await grid.loadPosts(true);
  expect(grid.getAllPosts()).toBe(posts);
  expect(grid.getGeneration()).toBe(generation);
  expect(mocks.sync).not.toHaveBeenCalled();
  expect(mocks.reconcile).not.toHaveBeenCalled();
  expect(deps.getFilteredPosts).not.toHaveBeenCalled();
  expect(deps.onPostsLoaded).not.toHaveBeenCalled();
});

test('投稿の差分が空でも手動グループの変更を反映する', async () => {
  const { grid } = createBuilder();
  await grid.loadPosts();
  const generation = grid.getGeneration();
  mocks.groups.mockResolvedValueOnce([['one', 'two']]);
  await grid.loadPosts(true);
  expect(grid.getManualGroups()).toEqual([['one', 'two']]);
  expect(grid.getGeneration()).toBe(generation + 1);
});

test('投稿の差分が空でも投稿者プロフィールの変更を反映する', async () => {
  const { grid, deps } = createBuilder();
  await grid.loadPosts();
  const generation = grid.getGeneration();
  store.setState({ browseMode: 'posters' });
  const profiles = [{ platform: 'x', userId: 'author', name: 'new' }];
  mocks.delta.mockResolvedValueOnce({ full: false, added: [], removed: [], profiles });
  await grid.loadPosts(true);
  expect(deps.onPostsLoaded).toHaveBeenLastCalledWith(profiles);
  expect(deps.renderPosters).toHaveBeenCalledWith(true);
  expect(grid.getGeneration()).toBe(generation);
});

test('追加と削除の差分では投稿の購読を更新する', async () => {
  const { grid } = createBuilder();
  await grid.loadPosts();
  mocks.delta.mockResolvedValueOnce({ full: false, added: [{ captureId: 'one' }], removed: [], profiles: [] });
  await grid.loadPosts(true);
  expect(grid.getAllPosts()).toEqual([{ captureId: 'one' }]);
  mocks.delta.mockResolvedValueOnce({ full: false, added: [], removed: ['one'], profiles: [] });
  await grid.loadPosts(true);
  expect(grid.getAllPosts()).toEqual([]);
  expect(mocks.sync).toHaveBeenCalledTimes(3);
});

test('ライブラリ移動中の応答は一覧を保持し、移動後の完全な一覧で置き換える', async () => {
  const { grid } = createBuilder();
  mocks.delta.mockResolvedValueOnce({ full: true, posts: [{ captureId: 'old' }], profiles: [] });
  await grid.loadPosts();
  const posts = grid.getAllPosts();
  mocks.delta.mockResolvedValueOnce({ paused: true, full: false, profiles: [] });
  await grid.loadPosts(true);
  expect(grid.getAllPosts()).toBe(posts);
  mocks.delta.mockResolvedValueOnce({ full: true, posts: [{ captureId: 'new' }], profiles: [] });
  await grid.loadPosts(true);
  expect(grid.getAllPosts()).toEqual([{ captureId: 'new' }]);
});

test('明示的な再読み込みでは空の差分でも表示条件を再評価する', async () => {
  const { grid, deps } = createBuilder();
  await grid.loadPosts();
  vi.clearAllMocks();
  await grid.loadPosts();
  expect(deps.getFilteredPosts).toHaveBeenCalledOnce();
  expect(deps.syncTitleAndPersist).toHaveBeenCalledOnce();
});

test('一覧更新中の投稿リンクは保留した再取得まで待って対象を解決する', async () => {
  const { grid } = createBuilder();
  await grid.loadPosts();
  let finishCurrent!: (value: PostsDelta) => void;
  let finishQueued!: (value: PostsDelta) => void;
  mocks.delta.mockReturnValueOnce(
    new Promise<PostsDelta>((resolve) => {
      finishCurrent = resolve;
    }),
  );
  mocks.delta.mockReturnValueOnce(
    new Promise<PostsDelta>((resolve) => {
      finishQueued = resolve;
    }),
  );
  const current = grid.loadPosts(true);
  const target = { url: 'https://x.com/fixture/status/2100000000000000001' };
  let resolved = false;
  const linked = resolveLinkedPost(target, { posts: grid.getAllPosts, reload: () => grid.loadPosts(true) }).then((post) => {
    resolved = true;
    return post;
  });
  expect(resolved).toBe(false);
  finishCurrent({ saveFolder: null, full: false, added: [], removed: [], profiles: [] });
  await vi.waitFor(() => expect(mocks.delta).toHaveBeenCalledTimes(3));
  expect(resolved).toBe(false);
  const post = { ...postView({ captureId: 'saved', url: target.url }), localViewCount: 0, tagIds: [] };
  finishQueued({ saveFolder: null, full: false, added: [post], removed: [], profiles: [] });
  expect(await linked).toBe(post);
  await current;
});

test('一覧取得の失敗後も次の読み込みを実行できる', async () => {
  const { grid } = createBuilder();
  mocks.delta.mockRejectedValueOnce(new Error('read failed'));
  await expect(grid.loadPosts()).rejects.toThrow('read failed');
  await grid.loadPosts();
  expect(mocks.delta).toHaveBeenCalledTimes(2);
});
