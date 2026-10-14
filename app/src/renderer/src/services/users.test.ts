import { describe, expect, test } from 'vitest';
import { makeUsers } from './users';

const keyOf = (p: DotPost) => `${p.platform}:${p.userId || `@${p.screenName || ''}`}`;

describe('buildUsers', () => {
  test('投稿の閲覧回数を合計し、最新の閲覧日時を使う', () => {
    const posts = [
      { platform: 'x', userId: 'a', localViewCount: 2, lastViewedAt: '2026-09-01T00:00:00.000Z' },
      { platform: 'x', userId: 'a', localViewCount: 5, lastViewedAt: '2026-09-02T00:00:00.000Z' },
      { platform: 'x', userId: 'b', localViewCount: 1 },
    ] as DotPost[];
    const users = makeUsers({ allPosts: () => posts, generation: () => 1, userKey: keyOf, hostOf: () => '' }).buildUsers();
    expect(users.find((u) => u.key === 'x:a')).toMatchObject({ localViewCount: 7, lastViewedAt: '2026-09-02T00:00:00.000Z' });
    expect(users.find((u) => u.key === 'x:b')?.lastViewedAt).toBeUndefined();
  });
  test('投稿者キーごとに件数と期間を集計する', () => {
    const posts = [
      { platform: 'x', userId: 'a', displayName: 'Alice', date: '2026-01-02', capturedAt: '2026-01-03' },
      { platform: 'x', userId: 'a', date: '2026-01-01', capturedAt: '2026-01-04' },
      { platform: 'bluesky', userId: 'a', displayName: 'Alice B', date: '2026-01-05', capturedAt: '2026-01-05' },
    ] as DotPost[];
    const users = makeUsers({ allPosts: () => posts, generation: () => 1, userKey: keyOf, hostOf: () => '' }).buildUsers();
    expect(users).toHaveLength(2);
    expect(users.find((u) => u.key === 'x:a')).toMatchObject({ count: 2, latest: '2026-01-02', firstPost: '2026-01-01', lastCapture: '2026-01-04' });
  });

  test('現在のプロフィールを投稿由来の値へ重ねる', () => {
    const posts = [{ platform: 'x', userId: 'a', displayName: 'Old', followers: 1 }] as DotPost[];
    const profiles = [{ key: 'x:a', displayName: 'Current', bio: 'Bio', followers: 20 }];
    const user = makeUsers({ allPosts: () => posts, profiles: () => profiles, generation: () => 1, userKey: keyOf, hostOf: () => '' }).buildUsers()[0];
    expect(user).toMatchObject({ displayName: 'Current', bio: 'Bio', followers: 20 });
    expect('profileHistory' in user).toBe(false);
  });

  test('同じサイト内でフォロワー数のパーセンタイルを計算する', () => {
    const posts = [
      { platform: 'x', userId: 'a', followers: 100 },
      { platform: 'x', userId: 'b', followers: 50 },
      { platform: 'x', userId: 'c', followers: 0 },
    ] as DotPost[];
    const users = makeUsers({ allPosts: () => posts, generation: () => 1, userKey: keyOf, hostOf: () => '' }).buildUsers();
    expect(users.find((u) => u.key === 'x:a')?.followerPercentile).toBe(1);
    expect(users.find((u) => u.key === 'x:b')?.followerPercentile).toBe(0.5);
    expect(users.find((u) => u.key === 'x:c')?.followerPercentile).toBe(0);
  });

  test('同順位は平均順位を使い、サイト別の母集団と欠損値を区別する', () => {
    const posts = [
      { platform: 'x', userId: 'a', followers: 100 },
      { platform: 'x', userId: 'b', followers: 100 },
      { platform: 'x', userId: 'c', followers: 50 },
      { platform: 'x', userId: 'd', followers: 0 },
      { platform: 'x', userId: 'e', followers: 0 },
      { platform: 'x', userId: 'missing' },
      { platform: 'bluesky', userId: 'solo', followers: 0 },
    ] as DotPost[];
    const users = makeUsers({ allPosts: () => posts, generation: () => 1, userKey: keyOf, hostOf: () => '' }).buildUsers();
    expect(users.map((user) => user.followerPercentile)).toEqual([0.875, 0.875, 0.5, 0.125, 0.125, null, 1]);
  });

  test('全員同数でも平均順位を使い、世代変更後のプロフィールを再集計する', () => {
    const posts = Array.from({ length: 1000 }, (_, index) => ({ platform: 'x', userId: String(index), followers: 0 })) as DotPost[];
    let generation = 1;
    const profiles = [{ key: 'x:0', followers: 0 }];
    const { buildUsers } = makeUsers({ allPosts: () => posts, profiles: () => profiles, generation: () => generation, userKey: keyOf, hostOf: () => '' });
    const initial = buildUsers();
    expect(initial.every((user) => user.followerPercentile === 0.5)).toBe(true);
    expect(buildUsers()).toBe(initial);
    profiles[0].followers = 100;
    generation++;
    expect(buildUsers()[0].followerPercentile).toBe(1);
  });
});
