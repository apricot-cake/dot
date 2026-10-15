// TanStack Virtual の lanes が段組み配置と仮想化を担う。アプリ側は、
// シェルのスクローラー、カード、履歴の測定キャッシュと接続する。
import { defaultRangeExtractor, measureElement as measureVirtualElement, useVirtualizer } from '@tanstack/react-virtual';
import { useStore } from 'zustand';
import { createPortal, flushSync } from 'react-dom';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { scroller as contentScroller } from '../services/content-area.ts';
import { registerGridNav } from '../services/grid-nav.ts';
import { getGridScrollRestoration, registerGridScroll, subscribeGridScrollRestoration } from '../services/grid-scroll-restoration.ts';
import type { GridScrollSnapshot } from '../services/grid-scroll-restoration.ts';
import { store } from '../services/store.ts';
import { anchorScrollTop, anchorViewportOffset, pickAnchorIndex, registerZoomAnchorSource } from '../services/zoom-anchor.ts';
import type { ZoomAnchor, ZoomAnchorCell } from '../services/zoom-anchor.ts';

export interface GridCellProps {
  index: number;
  data: any;
  width: number;
}

const ModelCtx = createContext<DotGridModel | null>(null);
export const useGridModel = () => useContext(ModelCtx) as DotGridModel;

type GridHostProps = { kind: 'post' | 'poster' | 'trash'; model: DotGridModel; cell: ComponentType<GridCellProps>; nav?: boolean; anchor?: boolean; onBackgroundClick?: () => void };

export function VirtualGridHost(props: GridHostProps) {
  const restoration = useSyncExternalStore(subscribeGridScrollRestoration, getGridScrollRestoration);
  return <VirtualGrid key={restoration.version} {...props} restoration={restoration.snapshot} />;
}

function VirtualGrid({ kind, model, cell: Cell, nav, anchor, onBackgroundClick, restoration }: GridHostProps & { restoration: GridScrollSnapshot | null }) {
  const scroller = contentScroller() as HTMLElement;
  const active = useStore(store, (state) => state.activeImageTab == null && state.browseMode === (kind === 'post' ? 'posts' : kind === 'poster' ? 'posters' : 'trash'));
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dims, setDims] = useState({ width: restoration?.width ?? 0, height: scroller.clientHeight, offset: restoration?.scrollMargin ?? 0, visible: false });
  const gap = model.rowGutter || 0;
  const lanes = model.columnCount || Math.max(1, Math.floor(((dims.width || 1) + gap) / ((model.columnWidth || 200) + gap)));
  const columnWidth = Math.max(1, ((dims.width || 1) - gap * (lanes - 1)) / lanes);
  const heldAnchor = useRef<ZoomAnchor | null>(null);
  const writtenScroll = useRef(scroller.scrollTop);
  const geometry = useRef<{ cells: ZoomAnchorCell[]; offset: number; itemsKey: string | number }>({ cells: [], offset: 0, itemsKey: model.itemsKey });
  const modelRef = useRef(model);
  modelRef.current = model;

  const captureAnchor = useCallback((): ZoomAnchor | null => {
    const current = geometry.current;
    const top = scroller.scrollTop;
    const visible = current.cells.filter((c) => c.top + current.offset < top + scroller.clientHeight && c.top + c.height + current.offset > top);
    if (!visible.length) return null;
    const selected = store.getState().selectedSet;
    const m = modelRef.current;
    const chosen =
      visible.find((c) => {
        const item = m.items[c.index];
        const key = m.keyOf?.(item, c.index);
        return key != null && selected.has(String(key));
      }) || visible.reduce((a, b) => (a.top < b.top || (a.top === b.top && a.index < b.index) ? a : b));
    return { index: chosen.index, viewportOffset: anchorViewportOffset(chosen.top, current.offset, top) };
  }, [scroller]);

  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!active || !el?.offsetWidth) {
      setDims((old) => (old.visible ? { ...old, visible: false } : old));
      return;
    }
    const width = el.offsetWidth;
    const height = scroller.clientHeight;
    const offset = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    setDims((old) => {
      if (old.visible && old.width === width && old.height === height && Math.abs(old.offset - offset) < 0.5) return old;
      if (old.width > 0 && old.width !== width && scroller.scrollTop > 0 && !heldAnchor.current) heldAnchor.current = captureAnchor();
      return { width, height, offset, visible: true };
    });
  }, [active, captureAnchor, scroller]);

  useLayoutEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [measure, scroller]);

  const getItemKey = useCallback((index: number) => model.keyOf?.(model.items[index], index) ?? index, [model.items, model.keyOf]);
  const estimateSize = useCallback(() => (model.square ? columnWidth : model.itemHeightEstimate || 120), [columnWidth, model.square, model.itemHeightEstimate]);
  // キャッシュは同じ列幅でだけ再利用する。異なる幅では安定キーのアンカーを使って復元する。
  const initialCache = useRef(restoration?.lanes === lanes ? restoration.measurements : []);
  if (dims.visible && restoration && restoration.width !== dims.width) initialCache.current = [];
  const virtualizer = useVirtualizer<HTMLElement, HTMLDivElement>({
    count: model.items.length,
    enabled: active && dims.visible,
    getScrollElement: () => scroller,
    initialOffset: () => restoration?.offset ?? scroller.scrollTop,
    initialMeasurementsCache: initialCache.current,
    getItemKey,
    measureElement: (element, entry, instance) => {
      // hidden のセルを高さ0として取り込み、共有スクローラーを補正しない。
      if (!active || !element.offsetWidth) return instance.measurementsCache[instance.indexFromElement(element)]?.size ?? estimateSize();
      return measureVirtualElement(element, entry, instance);
    },
    estimateSize,
    lanes,
    laneAssignmentMode: 'measured',
    gap,
    scrollMargin: dims.offset,
    scrollPaddingStart: gap,
    scrollPaddingEnd: gap,
    overscan: 3,
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range);
      const held = heldAnchor.current;
      return held && held.index >= 0 && held.index < model.items.length && !indexes.includes(held.index) ? [...indexes, held.index].sort((a, b) => a - b) : indexes;
    },
  });
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = heldAnchor.current ? () => false : undefined;
  const virtualItems = virtualizer.getVirtualItems();

  const layout = useRef({ width: dims.width, columnWidth, itemsKey: model.itemsKey });
  const seenZoomAnchor = useRef(model.zoomAnchor);
  const restored = useRef(false);
  useLayoutEffect(() => {
    if (!active || !dims.width || !dims.visible) return;
    const previous = layout.current;
    const freshZoom = model.zoomAnchor != null && model.zoomAnchor !== seenZoomAnchor.current;
    if (freshZoom) heldAnchor.current = model.zoomAnchor as ZoomAnchor;
    seenZoomAnchor.current = model.zoomAnchor;
    if (model.itemsKey !== previous.itemsKey && !freshZoom) heldAnchor.current = null;
    const sizeChanged = previous.width > 0 && (previous.width !== dims.width || previous.columnWidth !== columnWidth);
    if (sizeChanged && !heldAnchor.current && scroller.scrollTop > 0 && model.itemsKey === previous.itemsKey) heldAnchor.current = captureAnchor();
    layout.current = { width: dims.width, columnWidth, itemsKey: model.itemsKey };
    if (sizeChanged) {
      initialCache.current = [];
      virtualizer.measure();
      // 高さが変わらないセルには ResizeObserver が再通知しないため、
      // キャッシュを無効にした直後は表示中のセルを標準 API で測り直す。
      for (const node of containerRef.current?.children ?? []) virtualizer.measureElement(node as HTMLDivElement);
    }
    if (!restored.current) {
      restored.current = true;
      if (restoration?.anchor) {
        const index = model.items.findIndex((_, i) => getItemKey(i) === restoration.anchor?.key);
        if (index >= 0) heldAnchor.current = { index, viewportOffset: restoration.anchor.viewportOffset };
      }
    }
    const held = heldAnchor.current;
    if (held) {
      // align:start のスクロール位置は端でクランプされるため、項目座標を使う。
      virtualizer.getVirtualItems();
      const item = virtualizer.measurementsCache[held.index];
      if (item) {
        const target = anchorScrollTop(item.start - dims.offset, dims.offset, held.viewportOffset, Math.max(0, scroller.scrollHeight - scroller.clientHeight));
        if (Math.abs(target - scroller.scrollTop) > 0.5) virtualizer.scrollToOffset(target);
        writtenScroll.current = scroller.scrollTop;
      }
    }
    geometry.current = {
      cells: virtualizer.getVirtualItems().map((item) => ({ index: item.index, left: item.lane * (columnWidth + gap), top: item.start - dims.offset, width: columnWidth, height: item.size })),
      offset: dims.offset,
      itemsKey: model.itemsKey,
    };
  });

  useEffect(() => {
    const cancel = () => {
      heldAnchor.current = null;
    };
    const onScroll = () => {
      if (heldAnchor.current && Math.abs(scroller.scrollTop - writtenScroll.current) > 1) cancel();
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    scroller.addEventListener('wheel', cancel, { passive: true });
    scroller.addEventListener('touchstart', cancel, { passive: true });
    scroller.addEventListener('pointerdown', cancel, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      scroller.removeEventListener('wheel', cancel);
      scroller.removeEventListener('touchstart', cancel);
      scroller.removeEventListener('pointerdown', cancel);
    };
  }, [scroller]);

  useEffect(
    () =>
      registerGridScroll({
        capture: () => {
          if (!containerRef.current?.offsetWidth) return null;
          const a = captureAnchor();
          return {
            offset: scroller.scrollTop,
            measurements: virtualizer.takeSnapshot(),
            width: dims.width,
            scrollMargin: dims.offset,
            lanes,
            ...(a ? { anchor: { key: getItemKey(a.index), viewportOffset: a.viewportOffset } } : {}),
          };
        },
      }),
    [captureAnchor, dims.width, dims.offset, lanes, getItemKey, scroller, virtualizer],
  );

  const scrollIndexIntoView = useCallback(
    (index: number) => {
      heldAnchor.current = null;
      virtualizer.scrollToIndex(index, { align: 'auto' });
    },
    [virtualizer],
  );
  useEffect(() => (nav && active && dims.visible ? registerGridNav({ columnCount: () => lanes, scrollIntoView: scrollIndexIntoView }) : undefined), [nav, active, dims.visible, lanes, scrollIndexIntoView]);
  // 履歴の復元では保存位置を優先し、以前の reveal を再実行しない。
  // 非表示中に届いた新しい reveal は、表示されてから一度だけ処理する。
  const seenRevealSeq = useRef(restoration ? model.revealSeq : undefined);
  useEffect(() => {
    if (!active || !dims.visible || model.revealSeq == null || model.revealSeq === seenRevealSeq.current) return;
    seenRevealSeq.current = model.revealSeq;
    if (model.revealIndex != null && model.revealIndex >= 0) scrollIndexIntoView(model.revealIndex);
  }, [active, dims.visible, model.revealIndex, model.revealSeq, scrollIndexIntoView]);
  useEffect(() => {
    if (!anchor || !active || !dims.visible) return;
    return registerZoomAnchorSource({
      resolve: (clientX, clientY) => {
        const el = containerRef.current;
        if (!el?.offsetWidth) return null;
        const rect = el.getBoundingClientRect();
        const cells = geometry.current.cells.filter((c) => c.top + dims.offset < scroller.scrollTop + scroller.clientHeight && c.top + c.height + dims.offset > scroller.scrollTop);
        const index = pickAnchorIndex(cells, clientX - rect.left, clientY - rect.top);
        const chosen = cells.find((c) => c.index === index);
        return chosen ? { index: chosen.index, viewportOffset: anchorViewportOffset(chosen.top, dims.offset, scroller.scrollTop) } : null;
      },
    });
  }, [anchor, active, dims.offset, dims.visible, scroller]);

  // 余白のクリックは選択解除、ドラッグは選択を維持する。
  useEffect(() => {
    if (!onBackgroundClick) return;
    let start: { x: number; y: number } | null = null;
    const down = (e: MouseEvent) => {
      start = null;
      const el = containerRef.current;
      const target = e.target as HTMLElement;
      if (!el?.offsetWidth || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (target.closest('[data-slot="post-card"], [data-slot="poster-card"], a, button, input, textarea, select, [role="button"], [contenteditable="true"]')) return;
      if (e.clientX - scroller.getBoundingClientRect().left >= scroller.clientWidth) return;
      start = { x: e.clientX, y: e.clientY };
      el.focus({ preventScroll: true });
      e.preventDefault();
    };
    const up = (e: MouseEvent) => {
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 4) onBackgroundClick();
      start = null;
    };
    const cancel = () => {
      start = null;
    };
    scroller.addEventListener('mousedown', down);
    window.addEventListener('mouseup', up);
    window.addEventListener('blur', cancel);
    return () => {
      scroller.removeEventListener('mousedown', down);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('blur', cancel);
    };
  }, [onBackgroundClick, scroller]);

  return (
    <ModelCtx.Provider value={model}>
      <div ref={containerRef} role="grid" tabIndex={nav ? 0 : -1} style={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative', outline: 'none', overflowAnchor: 'none' }}>
        {virtualItems.map((item) => (
          <div role="gridcell" key={item.key} data-index={item.index} ref={virtualizer.measureElement} style={{ position: 'absolute', top: 0, left: item.lane * (columnWidth + gap), width: columnWidth, transform: `translateY(${item.start - dims.offset}px)` }}>
            <Cell index={item.index} data={model.items[item.index]} width={columnWidth} />
          </div>
        ))}
      </div>
    </ModelCtx.Provider>
  );
}

// ホストはシェルへ接続してから測定する。同期 push の完了後に呼び出し元が
// スクロール位置を扱えるよう、既存の flushSync 契約を維持する。
export function GridMount({ bridge, container, renderHost }: { bridge: DotGridSource; container: () => HTMLElement | null; renderHost: (model: DotGridModel) => ReactNode }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  if (!hostRef.current) {
    const h = document.createElement('div');
    h.style.width = '100%';
    hostRef.current = h;
  }
  const host = hostRef.current;
  const [model, setModel] = useState<DotGridModel | null>(null);

  useEffect(() => {
    // ホストへ描画する前に、ホストを容器へ取り付ける＝初回に offsetWidth を
    // 測るので、切り離されたままのホストは0と測る（グリッドが真っ白になる罠）。
    const attach = () => {
      const c = container();
      if (c && !host.isConnected) c.appendChild(host);
    };
    const sync = () => {
      const m = bridge.get();
      if (m) {
        attach();
        flushSync(() => setModel(m));
      } else {
        flushSync(() => setModel(null));
        host.remove(); // 枠がまた空になった＝その場所は空状態が使う
      }
    };
    const unsub = bridge.subscribe(sync);
    // この effect が走る前に push されたモデルを拾う＝素の setState（effect の中でも安全で、flushSync は要らない）。
    if (bridge.get()) {
      attach();
      setModel(bridge.get());
    }
    return unsub;
  }, [bridge, container, host]);

  return model ? createPortal(renderHost(model), host) : null;
}
