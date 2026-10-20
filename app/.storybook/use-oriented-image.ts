import type { Rotation } from '../src/renderer/src/image-tab/image-edit.ts';

// 実アプリは asset:// のみ許可する。Storybook では実ライブラリの参照用 URL だけを表示する。
export function useOrientedImage(src: string, rotation: Rotation, flipped: boolean) {
  const url = new URL(src, window.location.href);
  if (url.origin !== window.location.origin || url.pathname !== '/__dot_preview__/asset' || !url.searchParams.has('file')) return { src: undefined, rotation: 0 as Rotation, flipped: false, error: '画像を表示できませんでした' };
  return { src: url.href, rotation, flipped, error: undefined };
}
