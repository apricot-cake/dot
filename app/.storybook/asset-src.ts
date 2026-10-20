// Storybook では、Electron の asset:// を実ライブラリの参照用 URL に置き換える。
export { posterAvatarThumbnailWidth } from '../src/renderer/src/services/asset-src.ts';

export function fileSrc(file: string, w?: number): string {
  return file ? '/__dot_preview__/asset?file=' + encodeURIComponent(file) + (w ? '&w=' + w : '') : '';
}

export function fileOfSrc(src: string): string {
  const url = new URL(src, window.location.href);
  return url.origin === window.location.origin && url.pathname === '/__dot_preview__/asset' ? (url.searchParams.get('file') ?? '') : '';
}
