import type { VirtualItem } from '@tanstack/react-virtual';

export interface GridScrollSnapshot {
  offset: number;
  measurements: VirtualItem[];
  width: number;
  scrollMargin?: number;
  lanes: number;
  anchor?: { key: string | number; viewportOffset: number };
}

interface GridScrollHandle {
  capture(): GridScrollSnapshot | null;
}

const handles = new Set<GridScrollHandle>();
let restoration = { version: 0, snapshot: null as GridScrollSnapshot | null };
let pending: GridScrollSnapshot | null | undefined;
const listeners = new Set<() => void>();

export function registerGridScroll(handleToRegister: GridScrollHandle): () => void {
  handles.add(handleToRegister);
  return () => {
    handles.delete(handleToRegister);
  };
}

export function captureGridScroll(): GridScrollSnapshot | null {
  for (const handle of handles) {
    const snapshot = handle.capture();
    if (snapshot) return snapshot;
  }
  return null;
}

// Router が画面を切り替える前に準備し、モデルの更新後に flush する。
// 位置・測定キャッシュの持ち主は履歴エントリで、このサービスは現在のグリッドへの接続だけを持つ。
export function restoreGridScroll(snapshot: GridScrollSnapshot | null): void {
  pending = snapshot ?? { offset: 0, measurements: [], width: 0, lanes: 0 };
}

export function flushGridScrollRestoration(): void {
  if (pending === undefined) return;
  restoration = { version: restoration.version + 1, snapshot: pending };
  pending = undefined;
  for (const listener of listeners) listener();
}

export const getGridScrollRestoration = () => restoration;
export function subscribeGridScrollRestoration(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
