import { expect, test, vi } from 'vitest';
import { flushGridScrollRestoration, getGridScrollRestoration, restoreGridScroll, subscribeGridScrollRestoration } from './grid-scroll-restoration';

test('準備中の復元値は描画モデル確定後の flush まで公開しない', () => {
  const current = getGridScrollRestoration();
  const listener = vi.fn();
  const unsubscribe = subscribeGridScrollRestoration(listener);
  const next = { offset: 1400, measurements: [], width: 993, lanes: 3 };
  restoreGridScroll(next);
  expect(getGridScrollRestoration()).toBe(current);
  expect(listener).not.toHaveBeenCalled();
  flushGridScrollRestoration();
  expect(getGridScrollRestoration()).toEqual({ version: current.version + 1, snapshot: next });
  expect(listener).toHaveBeenCalledTimes(1);
  flushGridScrollRestoration();
  expect(listener).toHaveBeenCalledTimes(1);
  unsubscribe();
});
