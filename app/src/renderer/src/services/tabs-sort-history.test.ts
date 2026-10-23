// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { makeTabsController, type TabsBuilderDeps } from './tabs-builder.ts';
import { store } from './store.ts';
import { serializeTabs } from './tab-state.ts';

const { ipc } = vi.hoisted(() => ({ ipc: { getTabs: vi.fn(), setTabs: vi.fn(async () => ({ ok: true })), appendHistory: vi.fn(async () => ({ ok: true })) } }));
vi.mock('./ipc.ts', () => ({ dotIpc: ipc }));

let ctl: ReturnType<typeof makeTabsController>;
let deps: TabsBuilderDeps;
let editKey: unknown;
let scrollTop: number;

beforeEach(async () => {
  ipc.getTabs.mockResolvedValue(null);
  scrollTop = 0;
  editKey = null;
  store.setState({ browseMode: 'posts', activeImageTab: null, tabs: [], activeTabId: null, searchQuery: '', sortPost: 'date-desc', sortPoster: 'count', shuffleSeed: '', multiOnly: false });
  const tree: DotQueryGroup = { kind: 'group', op: 'and', neg: false, children: [] };
  deps = {
    t: (key) => key,
    tabTitleOf: () => ({ text: 'ホーム', iconType: 'all' }),
    postQB: { getTree: () => tree, setTree: vi.fn(), shadow: () => [] },
    getActiveFolderId: () => null,
    setActiveFolderId: vi.fn(),
    getSortValue: () => store.getState().sortPost,
    setSortValue: (sortPost) => store.setState({ sortPost }),
    getShuffleSeed: () => store.getState().shuffleSeed,
    setShuffleSeed: (shuffleSeed) => store.setState({ shuffleSeed }),
    searchQuery: () => store.getState().searchQuery,
    setSearchBoxValue: (value) => store.setState({ searchQuery: value ?? '' }),
    rebindEditingTextLeaf: vi.fn(),
    renderPosts: () => ctl.syncTitleAndPersist(),
    setLastRenderedState: vi.fn(),
    getAllPostsCount: () => 0,
    resetAllFilters: vi.fn(),
    setBrowseModeLite: (browseMode) => store.setState({ browseMode }),
    contentScrollTop: () => scrollTop,
    getPosterTree: () => tree,
    setPosterTree: vi.fn(),
    getPosterSort: () => store.getState().sortPoster,
    setPosterSort: (sortPoster) => store.setState({ sortPoster }),
    renderPosters: () => ctl.syncPosterTitleAndPersist(),
    restorePosterSelection: vi.fn(),
    showImageView: vi.fn(),
    hideImageView: () => store.setState({ activeImageTab: null }),
    getPostById: () => undefined,
    navCoalesceKey: () => editKey,
  };
  ctl = makeTabsController(deps);
  await ctl.initTabs();
  ctl.markBooted();
  await ctl.nav.router.load();
});

afterEach(() => ctl.persistTabsNow());

async function navigate(direction: 'back' | 'forward') {
  if (direction === 'back') ctl.navBack();
  else ctl.navForward();
  await ctl.nav.router.load();
}

async function changeSort(sort: string, seed = store.getState().shuffleSeed) {
  ctl.setNavPushNext();
  store.setState({ shuffleSeed: seed });
  if (store.getState().browseMode === 'posters') {
    store.setState({ sortPoster: sort });
    ctl.syncPosterTitleAndPersist();
  } else {
    store.setState({ sortPost: sort });
    ctl.syncTitleAndPersist();
  }
  await ctl.nav.router.load();
}

test('検索編集中のソート変更も独立して戻り、進むで並び順を復元する', async () => {
  editKey = 'search-session';
  store.setState({ searchQuery: '猫' });
  ctl.syncTitleAndPersist();
  await ctl.nav.router.load();
  scrollTop = 480;
  await changeSort('date-asc');
  expect(ctl.nav.current()).toMatchObject({ state: { sort: 'date-asc', search: '猫' } });
  await navigate('back');
  expect(store.getState()).toMatchObject({ sortPost: 'date-desc', searchQuery: '猫' });
  expect(ctl.nav.current()?.scrollTop).toBe(480);
  await navigate('forward');
  expect(store.getState()).toMatchObject({ sortPost: 'date-asc', searchQuery: '猫' });
});

test.each(['posts', 'posters'] as const)('%sの振り直しを戻る・進むで同じ種へ復元する', async (browseMode) => {
  store.setState({ browseMode });
  if (browseMode === 'posters') ctl.syncPosterTitleAndPersist();
  else ctl.syncTitleAndPersist();
  await ctl.nav.router.load();
  await changeSort('random', 'seed-a');
  await changeSort('random', 'seed-b');
  const steps = ctl.nav.router.history.length;
  await navigate('back');
  expect(store.getState().shuffleSeed).toBe('seed-a');
  expect(store.getState()[browseMode === 'posters' ? 'sortPoster' : 'sortPost']).toBe('random');
  await navigate('forward');
  expect(store.getState().shuffleSeed).toBe('seed-b');
  expect(ctl.nav.router.history.length).toBe(steps);
  await navigate('back');
  await changeSort('random', 'seed-c');
  expect(ctl.nav.canForward()).toBe(false);
});

test('投稿者のソートと種をタブ切替と再起動で復元する', async () => {
  store.setState({ browseMode: 'posters' });
  ctl.syncPosterTitleAndPersist();
  await ctl.nav.router.load();
  await changeSort('random', 'poster-seed');
  const tabId = store.getState().activeTabId!;
  ctl.addTab();
  await ctl.nav.router.load();
  store.setState({ shuffleSeed: 'other-tab-seed' });
  ctl.switchTab(tabId);
  await ctl.nav.router.load();
  expect(store.getState()).toMatchObject({ browseMode: 'posters', sortPoster: 'random', shuffleSeed: 'poster-seed' });
  ctl.persistTabsNow();
  ipc.getTabs.mockResolvedValue(serializeTabs(ctl.getTabs(), tabId));
  store.setState({ shuffleSeed: 'startup-seed' });
  await ctl.initTabs();
  await ctl.nav.router.load();
  expect(store.getState()).toMatchObject({ browseMode: 'posters', sortPoster: 'random', shuffleSeed: 'poster-seed' });
});
