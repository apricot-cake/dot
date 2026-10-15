import type { FunctionComponent } from 'react';
import { NavEntrySchema, TabViewSchema } from '../../../shared/data-schemas';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, defaultParseSearch, defaultStringifySearch } from '@tanstack/react-router';

// Router は共有し、文書タブごとに独立した MemoryHistory を接続する。
const rootRoute = createRootRoute();
export function configureNavigationRoot(component: FunctionComponent) {
  rootRoute.update({ component });
}
const validateSearch = (search: Record<string, unknown>) => ({
  view: TabViewSchema.parse(search.view ?? {}),
  entry: typeof search.entry === 'string' ? search.entry : '',
  scrollTop: typeof search.scrollTop === 'number' && search.scrollTop >= 0 ? search.scrollTop : 0,
});
const postsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/posts', validateSearch });
const postersRoute = createRoute({ getParentRoute: () => rootRoute, path: '/posters', validateSearch });
const imageRoute = createRoute({ getParentRoute: () => rootRoute, path: '/image', validateSearch: (search: Record<string, unknown>) => ({ ...validateSearch(search), view: NavEntrySchema.options[2].shape.state.parse(search.view) }) });
const routeTree = rootRoute.addChildren([postsRoute, postersRoute, imageRoute]);

export function createTabHistory(entries: string[], index: number) {
  const history = createMemoryHistory({ initialEntries: entries, initialIndex: index });
  // initialIndex=0 を末尾と扱う版でも、保存した位置へ正確に移す。
  const delta = index - history.location.state.__TSR_index;
  if (delta) history.go(delta);
  return history;
}
export function createTabRouter(entries: string[], index: number) {
  const history = createTabHistory(entries, index);
  // Router は位置を収集し、仮想グリッドの初期化が復元を担う。
  return createRouter({ routeTree, history, isServer: typeof window === 'undefined', defaultPendingMs: 0, scrollRestoration: () => false });
}
export type TabRouter = ReturnType<typeof createTabRouter>;
const navigationRouter = createTabRouter(['/posts'], 0);
export const getNavigationRouter = () => navigationRouter;
export function entryHref(entry: DotNavEntry, id = crypto.randomUUID()) {
  return `/${entry.kind}${defaultStringifySearch({ view: entry.state, entry: id, scrollTop: entry.scrollTop ?? 0 })}`;
}
export function entryFromHref(href: string): DotNavEntry {
  const [pathname, search = ''] = href.split('?');
  const kind = pathname === '/image' ? 'image' : pathname === '/posters' ? 'posters' : 'posts';
  const parsed = validateSearch(defaultParseSearch(`?${search}`));
  const state = parsed.view;
  return { kind, u: kind === 'image' ? `/image/${(state.recs as string[] | undefined)?.[0] ?? ''}` : `/${kind}`, state, scrollTop: parsed.scrollTop } as DotNavEntry;
}
