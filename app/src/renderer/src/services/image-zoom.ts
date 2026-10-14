import { get as confirmGet } from './confirm.ts';
import { isOpen as settingsIsOpen } from './settings.ts';
import { isTypingTarget, registerShortcut, tryRun } from './shortcut-registry.ts';

// Viewer.js のホイールとツールバーで共有する倍率の刻み。
export const ZOOM_STEP = 1.25;

// ツールバー（と Ctrl+0）が出せる命令。実装するのは舞台の側。
export interface ImageZoomController {
  step(dir: 1 | -1): void;
  fit(): void;
}

export interface ImageZoomState {
  // null は、今のスライドにズームが無いことと同値（動画、うごイラ、そもそも画像タブが無い）。
  readonly controller: ImageZoomController | null;
  readonly percent: number | null;
  readonly canZoomIn: boolean;
  readonly canZoomOut: boolean;
}

export type ImageZoomView = Omit<ImageZoomState, 'controller'>;

const IDLE: ImageZoomState = { controller: null, percent: null, canZoomIn: false, canZoomOut: false };

// 書き換えず必ず差し替える。そうすれば useSyncExternalStore のスナップショットの同一性が、
// 本物の変化の信号になる。
let state: ImageZoomState = IDLE;
const subs = new Set<() => void>();

const notify = () => {
  for (const cb of [...subs]) {
    try {
      cb();
    } catch (_e) {
      /* 1つの購読側の不調で、残りを止めてはいけない */
    }
  }
};

export const getState = (): ImageZoomState => state;
export function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

// 載っている舞台が呼ぶ。登録の解除は、呼び出し側がまだ生きている登録である時にだけ消す＝
// key 付きの載せ直しでは、新しいスライドが登録した後で古いスライドが畳まれることがある。
export function register(controller: ImageZoomController): () => void {
  state = { ...IDLE, controller };
  notify();
  return () => {
    if (state.controller !== controller) return;
    state = IDLE;
    notify();
  };
}

export function publish(view: ImageZoomView): void {
  const s = state;
  if (!s.controller) return; // 何も載っていない＝死んだスライドからの遅れたフレーム
  if (s.percent === view.percent && s.canZoomIn === view.canZoomIn && s.canZoomOut === view.canZoomOut) return;
  state = { controller: s.controller, ...view };
  notify();
}

// ウィンドウフィットのショートカットは、画像表示中だけ使える。
function canExecuteZoom(e: KeyboardEvent): boolean {
  if (!state.controller) return false;
  if (isTypingTarget(e)) return false;
  if (settingsIsOpen() || confirmGet()) return false;
  return true;
}

registerShortcut({
  id: 'zoom.fit',
  titleKey: 'shortcutZoomFit',
  defaultCombo: 'Ctrl+0',
  canExecute: canExecuteZoom,
  perform: () => state.controller?.fit(),
});

export function handleShortcutZoomKey(e: KeyboardEvent): void {
  tryRun('zoom.fit', e);
}
