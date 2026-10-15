import type { RouterHistory } from '@tanstack/react-router';
import { captureGridScroll, type GridScrollSnapshot } from './grid-scroll-restoration';
import { defaultParseSearch } from '@tanstack/react-router';
import { createTabHistory, createTabRouter, entryFromHref, entryHref, type TabRouter } from './navigation-router';
import type { Translate } from './translation.ts';
import { ASPECT_RATIOS } from './aspect-ratio.ts';
// タブの表示名、TanStack Router と保存形式の接続、タブ状態の永続化。
// 画面の描画は tabs-builder に注入し、保存・復元は DOM に依存させない。
import { dotIpc } from './ipc.ts';

export function genTabId() {
  return 'tab_' + Math.random().toString(36).slice(2, 10);
}

// deps の取り決め:
//   t(key,subs?)＝i18n のメッセージの引き当て（getMessage）
//   platformName(v)＝PF_NAME の引き当て。無ければ生の値を使う
//   formatShortDate(dateStr) / formatCount(n)＝viewer の整形の補助
//   folderName(id)＝フォルダの id を表示名へ解決する
//                   （不明なら null/undefined を返し、呼び出し側が代わりのものを使う）
export function makeTabLabels(deps: { t: Translate; platformName(v: string): string; formatShortDate(dateStr: string): string; formatCount(n: number | null | undefined): string; folderName(id: string): string | null | undefined }) {
  const { t, platformName, formatShortDate, formatCount, folderName } = deps;

  // 有効な絞り込み1つに対する、人が読めるラベルを返す。クエリチップの描画と、タブの
  // タイトルの生成が共有する。
  function filterLabel(f: { type: string; [k: string]: any }): string {
    switch (f.type) {
      case 'kind':
        return f.value === 'post' ? t('kindPost') : t('kindImage');
      case 'platform':
        return f.value === '__none' ? t('qfSiteNone') : platformName(f.value);
      // #253: 対応外ドメインの行の葉＝ホストそのものがラベルになる。
      case 'domain':
        return f.value;
      case 'postType':
        return f.value === 'post' ? t('qfPost') : f.value === 'reply' ? t('qfReply') : f.value === 'quote' ? t('qfQuote') : t('qfThread');
      case 'date': {
        const typeName = f.dateField === 'capturedAt' ? t('qfDateCaptured') : t('qfDatePost');
        const fromStr = f.from ? formatShortDate(f.from) : '';
        const toStr = f.to ? formatShortDate(f.to) : '';
        return `${typeName}: ${fromStr}〜${toStr}`;
      }
      // #162: width/height/long は px、サイズの軸は MB（保存されたバイト数から換算する）。
      case 'dimension': {
        const axisName = f.axis === 'width' ? t('qfDimWidth') : f.axis === 'height' ? t('qfDimHeight') : f.axis === 'long' ? t('qfDimLong') : t('qfDimBytes');
        const valueStr = f.axis === 'bytes' ? `${(f.value / 1048576).toFixed(1)}MB` : `${f.value}px`;
        return `${axisName} ${f.op === 'lte' ? '≤' : '≥'} ${valueStr}`;
      }
      // '__none' は「タグなし」（facets.ts）＝チップはそれを言葉で書く必要がある。
      // そうしないと、'__none' という名前のタグに見えてしまう。
      // #774: タグのエンティティ1つを表す葉は、ファセットの行が出していた曖昧さを解く
      // ラベル（"alice(東方)"）を持つ。それが無いと、同名のエンティティ2つが同じチップを
      // 付けてしまう。下の 'user' と同じく、無い時は生の値を使う形。
      case 'tag':
        return f.value === '__none' && f.tagId == null ? t('qfTagNone') : f.label || f.value;
      case 'hashtag':
        return `#${f.value}`;
      // フォルダのチップは、そのフォルダと下位フォルダの両方を表す（#41）。だから
      // そうでない方は、そうと書く必要がある＝でないと別々のクエリが同じチップを付ける。
      case 'folder':
        return (folderName(f.value) || f.value) + (f.only ? t('foldOnlySuffix') : '');
      case 'media':
        return f.value === 'image' ? t('qfImage') : f.value === 'video' ? t('qfVideo') : t('qfGif');
      case 'aspectRatio': {
        const ratio = ASPECT_RATIOS.find((item) => item.value === f.value);
        return ratio ? t(ratio.label) : f.value;
      }
      case 'user':
        return f.label || f.value;
      case 'text':
        return f.value;
      default:
        return f.value || f.type;
    }
  }

  // スナップショットの状態からタブのタイトルを導く。純粋関数（DOM は読まない）。
  // 有効なラベルを優先順に ・ でつなぐので、どのタブも一意になる。
  function tabTitleOf(state: DotTabSnapshot | null | undefined, _ctx: { allCount?: number | null } | null | undefined): { text: string; iconType: string } {
    const filters = (state && state.f) || [];
    const folderId = (state && state.folderId) || '';
    const search = (state && state.search) || '';
    const multi = !!(state && state.multi);
    if (!filters.length && !folderId && !search && !multi) {
      return { text: t('browsePosts'), iconType: 'home' };
    }

    const parts: string[] = [];
    let primaryIconType: string | null = null;
    const add = (label: string, iconType: string) => {
      parts.push(label);
      if (!primaryIconType) primaryIconType = iconType;
    };

    const byType: Record<string, any[]> = {};
    filters.forEach((f) => {
      (byType[f.type] = byType[f.type] || []).push(f);
    });

    // 静的フォルダは絞り込みではなく現在地。フィルタの葉と混ぜず、タブ名だけには
    // 先頭の場所として表すので、履歴とタブを見てもどこを開いているか分かる。
    if (folderId) add(folderName(folderId) || folderId, 'folder');

    // 検索の語は今は 'text' の葉（state.f の中）で、虫眼鏡のグリフを付けて最初に出す。
    if (byType.text)
      byType.text.forEach((f) => {
        const v = String(f.value || '');
        add('”' + (v.length > 12 ? v.slice(0, 12) + '…' : v) + '”', 'search');
      });
    if (byType.tag) byType.tag.forEach((f) => add(filterLabel(f), 'tag'));
    if (byType.hashtag) byType.hashtag.forEach((f) => add(filterLabel(f), 'hashtag'));
    if (byType.user) byType.user.forEach((f) => add(filterLabel(f), 'user'));
    filters.filter((f) => f.type === 'platform' || f.type === 'domain').forEach((f) => add(filterLabel(f), f.type));
    filters.filter((f) => f.type === 'postType' || f.type === 'media' || f.type === 'aspectRatio').forEach((f) => add(filterLabel(f), f.type));
    if (multi && !byType.media) add(t('qfMultiImage'), 'media');
    if (byType.date) byType.date.forEach((f) => add(filterLabel(f), 'date'));
    if (byType.dimension) byType.dimension.forEach((f) => add(filterLabel(f), 'dimension'));
    if (byType.kind) byType.kind.forEach((f) => add(filterLabel(f), 'kind'));
    filters.filter((f) => f.type === 'folder').forEach((f) => add(filterLabel(f), f.type));

    return { text: parts.join('・'), iconType: primaryIconType || 'all' };
  }

  function posterFilterLabel(f: { type: string; [k: string]: any }): string {
    if (f.type === 'date') {
      const dimName = f.dateField === 'lastCapture' ? t('posterDateLastCapture') : f.dateField === 'authorCreatedAt' ? t('posterDateCreated') : t('posterDateLastPost');
      const fromStr = f.from ? formatShortDate(f.from) : '';
      const toStr = f.to ? formatShortDate(f.to) : '';
      return `${dimName}: ${fromStr}〜${toStr}`;
    }
    if (f.type === 'followers') return `${t('detailFollowers')} ${f.op === 'lte' ? '≤' : '≥'} ${formatCount(f.min)}`;
    return filterLabel(f);
  }

  return { filterLabel, tabTitleOf, posterFilterLabel };
}

// エントリの擬似 URL を導く（ラベルと同一性のキー＝DotNavEntry.u を参照）。
// グリッドの種別は今のところクエリ文字列を持たない（正本は state。履歴のページ #145 は
// tabTitleOf 経由で state から表示ラベルを導く）＝u に同一性が要るのは image の種別だけ
// （「同じ画像を開き直しても積み上がらない」）。
export function navEntryUrl(kind: DotNavEntry['kind'], state: any): string {
  if (kind === 'image') return '/image/' + ((state && Array.isArray(state.recs) && state.recs[0]) || '');
  return kind === 'posters' ? '/posters' : '/posts';
}

// 履歴の移動・前方枝の破棄・現在位置は TanStack の MemoryHistory が管理する。
// 永続化用の URL ジャーナルだけを公開 subscribe から更新し、履歴の実行は再実装しない。
export function makeNavHistory(deps: { cap: number; enabled(): boolean; snapshot(): DotNavEntry; apply(e: DotNavEntry): void; onChange(): void; onPush?(e: DotNavEntry): void; router?: TabRouter; scrollReady?(): boolean }) {
  const { cap, enabled, snapshot, apply, onChange, onPush } = deps;
  let urls: string[] = [];
  const sessions = new Map<string, { urls: string[]; history: RouterHistory }>();
  const gridSnapshots = new Map<string, GridScrollSnapshot>();
  const scrollPositions = new Map<string, number>();
  let tabId: string | null = null;
  const router = deps.router ?? createTabRouter(['/posts'], 0);
  let initialized = false;
  let lastKey: unknown = null;
  const index = () => router.history.location.state.__TSR_index;
  function entryAt(href: string): DotNavEntry {
    const entry = entryFromHref(href);
    const id = String((defaultParseSearch(href.includes('?') ? href.slice(href.indexOf('?')) : '') as Record<string, unknown>).entry || '');
    const grid = gridSnapshots.get(id);
    const gridScroll = grid ? { ...grid, measurements: grid.measurements.filter((item): item is typeof item & { key: string | number } => typeof item.key !== 'bigint') } : undefined;
    return { ...entry, scrollTop: scrollPositions.get(id) ?? entry.scrollTop, gridScroll };
  }
  const current = (): DotNavEntry | null => (initialized ? entryAt(router.history.location.href) : null);
  const sameEntry = (a: DotNavEntry | null, b: DotNavEntry) => !!a && a.u === b.u && a.kind === b.kind && JSON.stringify(a.state) === JSON.stringify(b.state);
  let unsubscribe = () => {};
  function attach(nextUrls: string[], nextIndex: number, retainedHistory?: RouterHistory) {
    unsubscribe();
    urls = nextUrls;
    const history = retainedHistory ?? createTabHistory(urls.slice(), nextIndex);
    if (tabId) sessions.set(tabId, { urls, history });
    router.update({ history });
    initialized = true;
    unsubscribe = history.subscribe(({ location, action }) => {
      const i = location.state.__TSR_index;
      if (action.type === 'PUSH') urls.splice(i, urls.length - i, location.href);
      else if (action.type === 'REPLACE') urls[i] = location.href;
      void router.load();
      if (action.type === 'BACK' || action.type === 'FORWARD' || action.type === 'GO') {
        lastKey = null;
        const entry = current();
        if (entry) {
          apply(entry);
        }
        onChange();
      }
    });
    void router.load();
  }
  function navigate(e: DotNavEntry, replace: boolean) {
    const before = current();
    const search = { view: e.state as Record<string, unknown>, entry: replace ? routeEntryId() : crypto.randomUUID(), scrollTop: e.scrollTop ?? (replace ? (before?.scrollTop ?? 0) : 0) };
    void router.navigate({ to: `/${e.kind}`, search, replace, resetScroll: false });
  }
  function routeEntryId() {
    return String((defaultParseSearch(router.history.location.search) as Record<string, unknown>).entry || crypto.randomUUID());
  }
  function push(e: DotNavEntry) {
    if (!enabled()) return;
    lastKey = null;
    if (sameEntry(current(), e)) return;
    if (!initialized) attach([entryHref(e)], 0);
    else navigate(e, false);
    if (urls.length > cap) attach(urls.slice(-cap), cap - 1);
    pruneScrollMetadata();
    onChange();
    onPush?.(e);
  }
  function replace(e: DotNavEntry) {
    if (!enabled()) return;
    if (!initialized) {
      push(e);
      return;
    }
    if (sameEntry(current(), e)) return;
    const i = index();
    if (i > 0 && sameEntry(entryFromHref(urls[i - 1]), e)) {
      const trimmed = urls.slice();
      trimmed.splice(i, 1);
      attach(trimmed, i - 1);
      lastKey = null;
    } else navigate(e, true);
    pruneScrollMetadata();
    onChange();
  }
  function record(e: DotNavEntry, coalesceKey?: unknown) {
    if (coalesceKey != null && coalesceKey === lastKey) {
      replace(e);
      return;
    }
    push(e);
    lastKey = coalesceKey ?? null;
  }
  function saveScrollTop(scrollTop: number) {
    if (!initialized || !enabled() || deps.scrollReady?.() === false) return;
    const entry = current();
    if (entry) {
      if (entry.kind !== 'image') {
        const captured = captureGridScroll();
        if (captured) gridSnapshots.set(routeEntryId(), captured);
      }
      // 位置の更新は遷移ではない。Router の再読込や onRendered を起こさず、
      // 保存時だけ既存の履歴形式へ載せる。
      scrollPositions.set(routeEntryId(), Math.max(0, scrollTop));
    }
  }
  const canBack = () => initialized && index() > 0;
  const canForward = () => initialized && index() < router.history.length - 1;
  function back() {
    if (!canBack()) return false;
    router.history.back();
    return true;
  }
  function forward() {
    if (!canForward()) return false;
    router.history.forward();
    return true;
  }
  function adopt(t: DotTab | null | undefined) {
    lastKey = null;
    tabId = t?.id ?? null;
    const retained = tabId ? sessions.get(tabId) : undefined;
    if (retained) {
      attach(retained.urls, retained.history.location.state.__TSR_index, retained.history);
      onChange();
      return;
    }
    const saved = t?._navHist;
    const hydrate = (entry: DotNavEntry) => {
      const id = crypto.randomUUID();
      if (entry.gridScroll) gridSnapshots.set(id, entry.gridScroll);
      return entryHref(entry, id);
    };
    const nextUrls = saved?.length ? saved.map((value) => hydrate(JSON.parse(value))) : [hydrate({ ...snapshot(), scrollTop: t?._scrollTop ?? 0 })];
    const nextIndex = saved?.length ? Math.max(0, Math.min(t?._navIdx ?? saved.length - 1, saved.length - 1)) : 0;
    attach(nextUrls, nextIndex);
    onChange();
  }
  function pruneScrollMetadata() {
    const live = new Set(
      [...sessions.values()]
        .flatMap((session) => session.urls)
        .concat(urls)
        .map((href) => String((defaultParseSearch(href.slice(href.indexOf('?'))) as Record<string, unknown>).entry || '')),
    );
    for (const key of gridSnapshots.keys()) if (!live.has(key)) gridSnapshots.delete(key);
    for (const key of scrollPositions.keys()) if (!live.has(key)) scrollPositions.delete(key);
  }
  function releaseTab(id: string) {
    const session = sessions.get(id);
    sessions.delete(id);
    if (session && id !== tabId) session.history.destroy();
    if (id === tabId) urls = [];
    pruneScrollMetadata();
  }
  function saveInto(t: DotTab) {
    t._navHist = initialized ? urls.map((href) => JSON.stringify(entryAt(href))) : [];
    t._navIdx = initialized ? index() : -1;
  }
  function applyCurrent() {
    const entry = current();
    if (entry) {
      apply(entry);
    }
  }
  return { push, replace, record, back, forward, saveScrollTop, current, applyCurrent, adopt, saveInto, canBack, canForward, router, releaseTab, gridSnapshot: () => gridSnapshots.get(routeEntryId()) };
}

// タブ1枚が再起動後に戻ってくるために必要なものを、まとめて1つの不透明な塊にしたもの。
// main はこれを tabs テーブルの `state` 列へそのまま入れ、中を覗くことはない
// （lib-db-schema.ts がテーブルのところでそう書いている）。scrollTop も一緒に運ばれるので、
// ビューはタブの切り替えだけでなく再起動をまたいでも戻る。タブごとの戻る／進むのスタックは、
// 解析済みのエントリのオブジェクトとして `nav` の下に永続化される（#144 保留の判断5＝
// 大きさの上限は NAV_CAP だけ。Chrome も同じやり方でタブの履歴を再起動をまたいで運ぶ）。
// 旧来の renderLimit の欄は、窓で描く経路と一緒に無くなった＝仮想化するグリッドは
// scrollTop だけからどの深さでも戻せる（古い保存済みの欄は無視する）。
export type DotTabPersist = z.output<typeof TabPersistSchema>;
// 永続化するタブ1枚。塊の兄弟は id / pinned / title だけ＝main が索引を張る列がそれ
// （位置は配列の順序から来る）。
// #565: nav / scrollTop / autoTitle も以前は兄弟として載っていて、main の INSERT がそれを
// 黙って落としていた。だから戻る／進むのスタックとスクロール位置は再起動のたびに死んでいたのに、
// テストはすべて緑のままだった。ここの明示的な型が、それを直したまま保つ防ぎ＝4つ目の兄弟は
// 今やコンパイルエラーになるので、次のタブごとの欄は、生き残る場所へ置くしかない。
export type DotPersistedTab = TabRecord;
export type DotPersistedTabs = TabsState;

export function serializeTabs(tabs: DotTab[], activeTabId: string | null): DotPersistedTabs {
  return {
    activeTabId,
    tabs: tabs.map((t) => ({
      id: t.id,
      pinned: false,
      title: t.title,
      state: {
        ...(t._persistExtra || {}),
        view: t.state ?? null,
        autoTitle: t._autoTitle || undefined,
        scrollTop: t._scrollTop,
        nav: Array.isArray(t._navHist) && t._navHist.length ? { hist: t._navHist.map((s) => JSON.parse(s)), idx: t._navIdx } : undefined,
      },
    })),
  };
}

// 保存形式は共通スキーマで検証する。復元時には表示用 URL と添字だけを導出する。
export function sanitizeSavedTabs(saved: unknown, _genId: () => string): { tabs: DotTab[]; activeTabId: string } | null {
  if (saved == null) return null;
  const data = TabsSchema.parse(saved);
  if (!data.tabs.length) return null;
  const tabs: DotTab[] = data.tabs.map((t) => {
    const p = t.state;
    const clean = (view: typeof p.view) => {
      if (!view) return;
      if (view.tree) normalizeTree(view.tree);
      if (view.f) view.f = view.f.filter((leaf) => !isRemovedFilter(leaf));
      if (view.ops) {
        delete view.ops.engagement;
        delete view.ops.instance;
      }
    };
    clean(p.view);
    for (const entry of p.nav?.hist ?? []) {
      if (entry.kind !== 'image') clean(entry.state);
    }
    const hist = p.nav?.hist;
    const { view: _view, autoTitle: _autoTitle, scrollTop: _scrollTop, nav: _nav, ...persistExtra } = p;
    return {
      id: t.id,
      pinned: false,
      title: t.title,
      state: p.view,
      _autoTitle: p.autoTitle ?? false,
      _scrollTop: p.scrollTop ?? 0,
      _navHist: hist?.length ? hist.map((e) => JSON.stringify({ ...e, u: navEntryUrl(e.kind, e.state) })) : undefined,
      _navIdx: hist?.length ? Math.max(0, Math.min(p.nav?.idx ?? hist.length - 1, hist.length - 1)) : undefined,
      _persistExtra: Object.keys(persistExtra).length ? persistExtra : undefined,
    };
  });
  return { tabs, activeTabId: tabs.find((t) => t.id === data.activeTabId)?.id ?? tabs[0].id };
}

// tabs.json の読み込みと永続化（P4 の「IPC → service」の領域ごとのまとめの一部＝素の
// dotIpc.getTabs/setTabs の呼び出しを viewer.js からここへ、それが包む直列化・復元の
// 対の隣へ移した）。呼ばれるのはブラウザからだけ（viewer.js）で、Node の単体テストから
// 呼ばれることはない。
export async function loadTabs() {
  try {
    return await dotIpc.getTabs();
  } catch {
    return null;
  }
}
export async function persistTabs(tabs: DotTab[], activeTabId: string | null) {
  try {
    await dotIpc.setTabs(serializeTabs(tabs, activeTabId));
  } catch {
    /* できる範囲で */
  }
}
import { TabsSchema, type TabRecord, type TabsState, type TabPersistSchema } from '../../../shared/data-schemas.ts';
import { normalizeTree, isRemovedFilter } from './query';
import type { z } from 'zod';
