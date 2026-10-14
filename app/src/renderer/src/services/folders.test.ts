import { beforeAll, expect, test, vi } from 'vitest';

vi.mock('./ui.ts', () => ({ notify: vi.fn() }));
vi.mock('./i18n.ts', () => ({ dotI18n: Promise.resolve({ t: (key: string) => key }) }));
vi.mock('./ipc.ts', () => ({ dotIpc: {} }));

let createFolderStore: typeof import('./folders.ts').createFolderStore;
beforeAll(async () => {
  ({ createFolderStore } = await import('./folders.ts'));
});
const folder = (id: string, items: string[], parentId: string | null = null) => ({ id, name: id, items, parentId }) as DotFolder;
const makeStore = () => createFolderStore({ idPrefix: 'test', persist: vi.fn(), isLibrary: true });

test('所属の索引は追加・削除・切り替え・不要項目の整理を反映する', () => {
  const store = makeStore();
  store.setAll([folder('root', ['a', 'a']), folder('child', ['b'], 'root')]);
  expect(store.hasDeep('root', 'b')).toBe(true);
  expect(store.hasDeep('root', 'b', true)).toBe(false);
  expect(store.has('root', 'a')).toBe(true);
  store.applyItems('root', ['c'], ['a']);
  expect(store.has('root', 'a')).toBe(false);
  expect(store.hasDeep('root', 'c')).toBe(true);
  store.toggleIn('child', ['b']);
  expect(store.hasDeep('root', 'b')).toBe(false);
  store.applyItems('child', ['d'], []);
  expect(store.hasDeep('root', 'd')).toBe(true);
  store.reconcile(new Set(['c']));
  expect(store.hasDeep('root', 'd')).toBe(false);
  expect(store.has('root', 'c')).toBe(true);
});

test('所属の索引は親の変更・削除・全体の置換を反映する', () => {
  const store = makeStore();
  store.setAll([folder('root', []), folder('other', []), folder('child', ['a'], 'root')]);
  expect(store.hasDeep('root', 'a')).toBe(true);
  store.reparent('child', 'other');
  expect(store.hasDeep('root', 'a')).toBe(false);
  expect(store.hasDeep('other', 'a')).toBe(true);
  store.place('child', 'root', 'into');
  expect(store.hasDeep('root', 'a')).toBe(true);
  store.remove('child');
  expect(store.hasDeep('root', 'a')).toBe(false);
  store.setAll([folder('root', ['new'])]);
  expect(store.hasDeep('root', 'new')).toBe(true);
  expect(store.has('root', 'a')).toBe(false);
});

test('重複IDは最初のフォルダを使い、循環があっても子孫の照合が終了する', () => {
  const store = makeStore();
  store.setAll([folder('a', ['first'], 'b'), folder('a', ['second']), folder('b', ['child'], 'a')]);
  expect(store.hasDeep('a', 'child')).toBe(true);
  expect(store.hasDeep('a', 'first')).toBe(true);
  expect(store.hasDeep('a', 'second')).toBe(false);
  expect(store.hasDeep(null, 'first')).toBe(false);
  expect(store.hasDeep('missing', 'first')).toBe(false);
});
