// 画像ズームのコントローラ登録、状態通知、ショートカットを検証する。
import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as Z from './image-zoom';

describe('コントローラ登録: 「今ズームできる面があるか」の唯一の情報源', () => {
  const ctl = () => ({ step: vi.fn(), fit: vi.fn() });

  test('未登録なら controller は null＝ツールバーは disabled 側', () => {
    expect(Z.getState().controller).toBeNull();
  });

  test('登録で controller が入り、解除で戻る', () => {
    const c = ctl();
    const off = Z.register(c);
    expect(Z.getState().controller).toBe(c);
    off();
    expect(Z.getState().controller).toBeNull();
  });

  test('解除は自分がまだ現役のときだけ効く＝スライド差し替えの順序で新しい方を消さない', () => {
    const a = ctl();
    const b = ctl();
    const offA = Z.register(a);
    const offB = Z.register(b); // 新しいスライドが先に登録する
    offA(); // 古いスライドの片付けが後から来る
    expect(Z.getState().controller).toBe(b);
    offB();
  });

  test('publish は変化したときだけ購読者を起こす', () => {
    const off = Z.register(ctl());
    const seen = vi.fn();
    const unsub = Z.subscribe(seen);
    const view = { percent: 125, canZoomIn: true, canZoomOut: true };
    Z.publish(view);
    Z.publish({ ...view });
    expect(seen).toHaveBeenCalledTimes(1);
    expect(Z.getState().percent).toBe(125);
    unsub();
    off();
  });

  test('登録が無いときの publish は素通り＝死んだスライドの最終フレームが残らない', () => {
    Z.publish({ percent: 999, canZoomIn: true, canZoomOut: true });
    expect(Z.getState().percent).toBeNull();
  });
});

describe('ウィンドウフィットのショートカット', () => {
  const key = (init: Partial<KeyboardEvent> & { key: string }) => {
    const e = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, target: null, preventDefault: vi.fn(), ...init } as unknown as KeyboardEvent;
    return e;
  };
  const make = () => ({ step: vi.fn(), fit: vi.fn() });
  let c: ReturnType<typeof make>;
  let off: (() => void) | undefined;

  beforeEach(() => {
    c = make();
    off?.();
    off = Z.register(c);
  });

  test('Ctrl+0 はフィット・Ctrl+1 は何もしない', () => {
    Z.handleShortcutZoomKey(key({ key: '0', ctrlKey: true }));
    expect(c.fit).toHaveBeenCalledTimes(1);
    const removed = key({ key: '1', ctrlKey: true });
    Z.handleShortcutZoomKey(removed);
    expect(removed.preventDefault).not.toHaveBeenCalled();
  });

  test('修飾なし・Shift/Alt 併用・別のキーは素通し', () => {
    for (const e of [key({ key: '0' }), key({ key: '0', ctrlKey: true, shiftKey: true }), key({ key: '1', ctrlKey: true, altKey: true }), key({ key: '2', ctrlKey: true })]) {
      Z.handleShortcutZoomKey(e);
    }
    expect(c.fit).not.toHaveBeenCalled();
  });

  test('入力欄にフォーカスがあるときは奪わない', () => {
    Z.handleShortcutZoomKey(key({ key: '0', ctrlKey: true, target: { tagName: 'INPUT' } as unknown as EventTarget }));
    expect(c.fit).not.toHaveBeenCalled();
  });

  test('ズームできる面が無ければ何もしない＝グリッドや動画スライドでは素通し', () => {
    off();
    off = () => {};
    const e = key({ key: '0', ctrlKey: true });
    Z.handleShortcutZoomKey(e);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });
});
