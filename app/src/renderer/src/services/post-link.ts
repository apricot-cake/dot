import { postKeyOf } from '../../../../../native-host/post-key.mts';
import type { PostLink } from '../../../shared/post-link.ts';

export function findLinkedPost<T extends { url?: string | null; saveScope?: string; media?: Array<{ url?: string | null }> }>(posts: T[], target: PostLink): T | undefined {
  const key = postKeyOf(target.url);
  if (!key) return undefined;
  return posts.find((post) => postKeyOf(post.url) === key && (target.mediaUrl ? post.saveScope === 'media' && post.media?.some((item) => item.url === target.mediaUrl) : post.saveScope !== 'media'));
}

export async function resolveLinkedPost<T extends { url?: string | null; saveScope?: string; media?: Array<{ url?: string | null }> }>(target: PostLink, deps: { posts(): T[]; reload(): Promise<void> }, refresh = true): Promise<T | undefined> {
  // 初回起動では直前に取得した一覧を使う。起動中の保存がまだ届いていない場合だけ再取得する。
  if (!refresh) {
    const existing = findLinkedPost(deps.posts(), target);
    if (existing) return existing;
  }
  await deps.reload();
  return findLinkedPost(deps.posts(), target);
}
