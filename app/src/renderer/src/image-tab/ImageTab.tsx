import { copyImage, copyableImages } from '../services/image-copy.ts';
import { fileOfSrc } from '../services/asset-src.ts';
import { open as openMenu } from '../services/menu.ts';
import { t } from '../_shared/i18n.ts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ImageOff } from 'lucide-react';
import 'react-image-crop/dist/ReactCrop.css';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { register as registerEditControls } from '../services/image-edit-controls.ts';
import { ImageEditor } from './ImageEditor.tsx';
import { useOrientedImage } from './use-oriented-image.ts';
import { orientedFrameLayout, orientedDimensions } from './oriented-image-frame.tsx';
import { flipEdit, rotateEdit, type Rotation } from './image-edit.ts';
import { UgoiraPlayer } from './UgoiraPlayer.tsx';
import { createNeighborPreloader, neighborPreloadSources, type NeighborPreloader } from './preload.ts';
import Viewer from 'viewerjs';
import 'viewerjs/dist/viewer.css';
import './viewer-frame.css';
import { ZOOM_STEP, publish as publishZoom, register as registerZoom } from '../services/image-zoom.ts';
// image-tab/index.tsx が組み立てるモデル。投稿グループ1つ分のギャラリー
// 項目、制御される添字、タブ単位の操作を持つ。ズーム・パンの状態はこのコンポーネントの
// 中に留まる（一時的なもの＝key によってスライドごとにウィンドウ合わせの状態で載せ直る）。
export interface ImageTabItem {
  src: string;
  video?: boolean;
  alt?: string;
  // pixiv のうごイラの書庫。ライブラリ内のファイル名と、再生に使うフレーム表を持つ
  // （#119 St3）。書庫が開くまでは `poster` が代役を務める。
  ugoira?: { file: string; frames: { file: string; delay: number }[] };
  poster?: string;
  postId?: string;
  mediaSeq?: number;
  crop?: CropRect | null;
  rotation?: Rotation;
  flipped?: boolean;
  width?: number;
  height?: number;
}
export type CropRect = import('../../../../../native-host/post-schemas.mts').CropRectShape;
export interface ImageTabModel {
  positionLabel?: string;
  // 今表示しているタブ自身の id（#80）＝image-tab/index.tsx が <ImageTab> の key に
  // これを使う。だから画像タブから別の画像タブへ直接切り替えると（どちらも既に画像
  // ビューを出している）、このコンポーネントは使い回されずに載せ直される。それが
  // 編集中の状態が別のタブへ引き継がれるのを防いでいる。
  tabId: string;
  items: ImageTabItem[];
  idx: number;
  missing?: boolean;
  labels: Record<string, string>;
  onIndexChange?: (i: number) => void;
  onCloseTab?: () => void;
}

// Viewer.js の標準フィット・ホイール補間を、dot のツールバーと編集情報へ接続する。
function Zoomable({ src, alt, flip, rotation = 0, crop }: { src: string; alt: string; flip: boolean; rotation?: Rotation; crop?: CropRect | null }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const root = rootRef.current;
    const source = sourceRef.current;
    if (!root || !source) return;
    let viewer: Viewer | null = null;
    let image: HTMLImageElement | null = null;
    let ratio = 1;
    const transitions: Viewer.TransitionOptions = { view: false, rotate: false, scale: false, move: true, zoom: true };
    const layout = () => orientedFrameLayout(image?.naturalWidth ?? 0, image?.naturalHeight ?? 0, rotation, flip, root.clientWidth, root.clientHeight, crop);
    const fitRatio = () => (image?.naturalWidth ? layout().image.width / image.naturalWidth : 0.01);
    const publish = () => {
      if (!image) return;
      publishZoom({ percent: Math.round(ratio * 100), canZoomIn: ratio < 4, canZoomOut: ratio > fitRatio() + 0.00001 });
    };
    const fit = (animate = true) => {
      if (!viewer || !image) return;
      const previousTransition = image.style.transition;
      if (!animate) image.style.transition = 'none';
      const fitted = layout();
      const next = fitRatio();
      viewer.zoomTo(next);
      const oriented = orientedDimensions(image.naturalWidth, image.naturalHeight, rotation);
      const region = crop ?? { x: 0, y: 0, width: 1, height: 1 };
      const centerX = root.clientWidth / 2 - (region.x + region.width / 2 - 0.5) * oriented.width * next;
      const centerY = root.clientHeight / 2 - (region.y + region.height / 2 - 0.5) * oriented.height * next;
      viewer.moveTo(centerX - (image.naturalWidth * next) / 2, centerY - (image.naturalHeight * next) / 2);
      ratio = fitted.image.width / image.naturalWidth;
      if (!animate) {
        image.getBoundingClientRect();
        image.style.transition = previousTransition;
      }
      publish();
    };
    const createViewer = () =>
      new Viewer(source, {
        inline: true,
        initialCoverage: 1,
        minWidth: 0,
        minHeight: 0,
        className: 'dot-image-viewer',
        backdrop: false,
        button: false,
        navbar: false,
        toolbar: false,
        title: false,
        tooltip: false,
        fullscreen: false,
        keyboard: false,
        loading: false,
        focus: false,
        navigation: { prev: false, next: false },
        transition: transitions,
        zoomRatio: ZOOM_STEP - 1,
        minZoomRatio: () => fitRatio(),
        maxZoomRatio: 4,
        viewed: (event) => {
          image = event.detail.image;
          image.dataset.slot = 'viewer-image';
          let edit = { crop: crop ?? null, rotation, flipped: flip };
          if (edit.flipped) edit = flipEdit(edit);
          for (let turns = (4 - rotation / 90) % 4; turns > 0; turns--) edit = rotateEdit(edit);
          if (edit.crop) {
            const c = edit.crop;
            image.style.clipPath = `inset(${c.y * 100}% ${(1 - c.x - c.width) * 100}% ${(1 - c.y - c.height) * 100}% ${c.x * 100}%)`;
          }

          viewer?.rotateTo(rotation);
          if (flip) {
            if (rotation % 180) viewer?.scaleY(-1);
            else viewer?.scaleX(-1);
          }
          fit(false);
        },
        zoom: (event) => {
          ratio = event.detail.ratio;
          publish();
        },
      });
    viewer = createViewer();
    let previousWidth = root.clientWidth;
    let previousHeight = root.clientHeight;
    const unregister = registerZoom({
      step: (dir) => viewer?.zoom(dir > 0 ? ZOOM_STEP - 1 : -(ZOOM_STEP - 1)),
      fit: () => fit(),
    });
    const observer = new ResizeObserver(() => {
      const width = root.clientWidth;
      const height = root.clientHeight;
      if (width === previousWidth && height === previousHeight) return;
      previousWidth = width;
      previousHeight = height;
      // サイズの変わったインラインビューアだけを作り直す。
      viewer?.destroy();
      image = null;
      viewer = createViewer();
    });
    observer.observe(root);
    return () => {
      observer.disconnect();
      unregister();
      viewer?.destroy();
    };
  }, [rotation, flip, crop]);
  return (
    <div ref={rootRef} data-slot="viewer-zoom-wrapper" className="h-full min-h-0 w-full min-w-0">
      <img ref={sourceRef} src={src} alt={alt} className="hidden" />
    </div>
  );
}
function OrientedImage({ item }: { item: ImageTabItem }) {
  const image = useOrientedImage(item.src, item.rotation ?? 0, !!item.flipped);
  if (image.error) return <div role="alert">{image.error}</div>;
  if (!image.src) return <div className="m-auto">読み込み中…</div>;
  return <Zoomable key={`${image.src}:${image.rotation}:${image.flipped}`} src={image.src} alt={item.alt || ''} flip={image.flipped} rotation={image.rotation} crop={item.crop} />;
}

// ステージ全体。メディア＋前後の送り＋枚数表示＋インスペクタの切り替え。欠落した状態
// （投稿がライブラリから削除された）でも、空状態の規則（次の行動を必ず示す）に従って
// タブを閉じられるままにする。そして今は、アプリの他のすべての空状態と同じ Empty の
// 作りを着ている（P2⑫）。
export function ImageTab({ model }: { model: ImageTabModel }) {
  const { items, idx, missing, labels } = model;
  const i = items.length ? Math.max(0, Math.min(idx, items.length - 1)) : 0;
  // 隣を取得済みに保つ（#241）。フックの順序を安定させるため、欠落状態
  // の return より上に置く。一覧が空なら、何も先読みせず前のタブが抱えていたものを手放す
  // だけになる。
  const preloader = useRef<NeighborPreloader | null>(null);
  const [editing, setEditing] = useState(false);
  const currentItem = items[i];
  const closeEditor = useCallback(() => setEditing(false), []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 画像の切り替えで編集を終了する。
  useEffect(() => setEditing(false), [currentItem?.src]);
  useEffect(() => {
    if (editing || missing || !currentItem || currentItem.video || currentItem.ugoira || !currentItem.postId || currentItem.mediaSeq == null) return;
    return registerEditControls({ editing: false, start: () => setEditing(true) });
  }, [editing, missing, currentItem]);
  useEffect(() => {
    if (!preloader.current) preloader.current = createNeighborPreloader();
    preloader.current.sync(neighborPreloadSources(items, i));
  }, [items, i]);
  useEffect(() => () => preloader.current?.clear(), []);
  if (missing || !items.length) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ImageOff />
          </EmptyMedia>
          <EmptyTitle>{labels.missing}</EmptyTitle>
          <EmptyDescription>{labels.missingDesc}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" onClick={() => model.onCloseTab?.()}>
            {labels.closeTab}
          </Button>
        </EmptyContent>
      </Empty>
    );
  }
  const item = items[i];
  const multi = items.length > 1;
  const step = (d: number) => {
    setEditing(false);
    model.onIndexChange?.((i + d + items.length) % items.length);
  };
  return (
    // スライドごとの `key` は残す（#241 は選択を実装に委ねた）。送りのたびにズーム・パンを
    // ウィンドウ合わせへ戻すのはこれだし、あるスライドの再生状態（うごイラのデコードの
    // ループ、<video> の再生位置）が次へ滲み出すのを止めているのもこれ。外せば、それらを
    // すべて src の変化を見る effect から導き直すことになる＝速くしたい対象より確実に
    // 広い面になる。preload.ts は隣の取得だけを先行させ、選択後の <img> がその資源を使う。
    <div
      data-slot="image-tab-stage"
      className="relative flex min-w-0 flex-1 overflow-hidden"
      onContextMenu={(event) => {
        const file = !item.video && !item.ugoira && copyableImages([fileOfSrc(item.src)])[0];
        if (!file || editing) return;
        event.preventDefault();
        openMenu({ x: event.clientX, y: event.clientY, items: [{ label: t('ctxCopyImage'), act: 'copyImage' }] }, () => {
          void copyImage(file);
        });
      }}
    >
      {item.ugoira ? (
        <UgoiraPlayer key={item.src} file={item.ugoira.file} frames={item.ugoira.frames} poster={item.poster} alt={item.alt} labels={labels} flip={false} />
      ) : item.video ? (
        <video key={item.src} data-slot="viewer-video" className={`m-auto max-h-full max-w-full object-contain`} src={item.src} controls playsInline preload="metadata" />
      ) : (
        <OrientedImage key={`${item.src}:${JSON.stringify(item.crop ?? null)}:${item.rotation}:${item.flipped}`} item={item} />
      )}
      {editing && <ImageEditor key={item.src} item={item} onClose={closeEditor} />}
      {multi && !editing && (
        <div data-slot="image-tab-navigation" className="absolute bottom-4 left-1/2 z-2 flex max-w-[calc(100%-16px)] -translate-x-1/2 items-center gap-0.5 rounded-full border border-border bg-background p-[3px] text-foreground shadow-sm">
          <Button data-slot="image-tab-prev" variant="ghost" size="icon" aria-label={labels.prev} onClick={() => step(-1)} className="size-9 shrink-0 rounded-full active:not-aria-[haspopup]:translate-y-0 [@media(pointer:coarse)]:size-11">
            <ChevronLeft className="size-[18px]" />
          </Button>
          {/* 最大桁数の幅を先に確保し、画像送りでボタンの位置を動かさない。 */}
          <div data-slot="image-tab-counter" className="grid min-w-12 overflow-hidden whitespace-nowrap text-center text-xs tabular-nums">
            <span aria-hidden="true" className="invisible col-start-1 row-start-1">
              {(model.positionLabel || `${i + 1} / ${items.length}`).replace(/\d+/g, '9'.repeat(String(items.length).length))}
            </span>
            <span aria-live="polite" className="col-start-1 row-start-1 truncate">
              {model.positionLabel || `${i + 1} / ${items.length}`}
            </span>
          </div>
          <Button data-slot="image-tab-next" variant="ghost" size="icon" aria-label={labels.next} onClick={() => step(1)} className="size-9 shrink-0 rounded-full active:not-aria-[haspopup]:translate-y-0 [@media(pointer:coarse)]:size-11">
            <ChevronRight className="size-[18px]" />
          </Button>
        </div>
      )}
    </div>
  );
}
