import { mediaKeyOf } from './extractor/index.ts';
import type { MediaItem } from './extractor/types.ts';

export function selectPostMedia(items: MediaItem[], platform: string, keys?: string[]): MediaItem[] {
  if (keys === undefined) return items;
  if (!Array.isArray(keys) || !keys.length || keys.some((key) => typeof key !== 'string')) throw new Error('Selected media could not be identified');
  const selected = items.filter((item) =>
    [item.url, item.poster].some((url) => {
      const key = mediaKeyOf(platform, url);
      return key !== null && keys.includes(key);
    }),
  );
  // 一致しない媒体を代わりに保存しない。URL の保存は続け、後で再取得する。
  return selected.length === 1 ? selected : [];
}
