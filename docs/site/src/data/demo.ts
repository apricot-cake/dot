export const STEP_MS = 5600;
// 検索デモの順序。実アプリはIME確定後に即時検索し、ここでは結果が現れる間隔を見せる。
export const SEARCH_START_MS = 1500;
export const MENU_TIMING = { filterOpen: 800, filterClose: 2200, sortMove: 2400, sortOpen: 3100, sortClose: 5100 } as const;
export const SEARCH_TIMING = { moveEnd: 700, click: 900, typeStart: 1200, typeEnd: 2200, convert: 2400, commit: 2800, results: 3000 } as const;
export const demoCopy = {
  title: '保存した一枚に、また出会う。',
  steps: ['ワンクリックで保存', '投稿情報から検索', 'フィルタとソート'],
  author: 'あんず',
  post: '青雀 #崩壊スターレイル',
  saved: '1件保存しました',
  save: '投稿を保存',
  saving: '保存中 1件',
  library: 'すべての投稿',
  posts: 'ホーム',
  history: '履歴',
  folders: 'フォルダ',
  posters: '投稿者',
  tags: 'タグ',
  trash: 'ゴミ箱',
  details: '詳細',
  settings: '設定',
  filter: 'フィルタ',
  sortDate: '投稿日',
  source: '元URL',
  engagement: '反応',
  text: '本文',
  work: '作品',
  character: 'キャラ',
  posted: '投稿日',
  workName: '崩壊：スターレイル',
  characterName: '青雀',
  tag: 'あとで見る',
  search: 'ライブラリ内を検索',
  date: '保存日時',
  image: '崩壊：スターレイルの青雀のイラスト',
  query: '青雀',
  imeQuery: 'せいじゃく',
} as const;

export interface DemoMetrics {
  likes: number;
  reposts: number;
  replies: number;
  bookmarks: number;
  views: number;
}
export const demoEngagement = [
  { kind: 'likes', label: 'いいね' },
  { kind: 'reposts', label: 'リポスト' },
  { kind: 'replies', label: '返信' },
  { kind: 'bookmarks', label: 'ブックマーク' },
  { kind: 'views', label: '表示数' },
] as const;

export interface DemoPost {
  id: string;
  image: string;
  text: string;
  alt: string;
  author: string;
  handle: string;
  source: string;
  postedAt: string;
  dateLabel: string;
  metrics: DemoMetrics;
}
const author = { author: demoCopy.author, handle: '@sample_apricot' };
// 件数・投稿URL・日時は操作デモ用の架空データ。
export const demoPosts: readonly DemoPost[] = [
  { id: 'qingque', image: 'qingque.webp', text: demoCopy.post, alt: demoCopy.image, ...author, source: 'https://x.com/sample_apricot/status/1003', postedAt: '2026/10/01 12:00', dateLabel: '10月1日', metrics: { likes: 96, reposts: 7, replies: 4, bookmarks: 18, views: 3200 } },
  {
    id: 'nanoka-bookoff',
    image: 'nanoka-bookoff.png',
    text: 'なのか × BOOKOFF #まのさば',
    alt: 'まのさばのなのかのブックオフコラボのファンアート',
    ...author,
    source: 'https://x.com/sample_apricot/status/1001',
    postedAt: '2026/09/30 12:00',
    dateLabel: '9月30日',
    metrics: { likes: 128, reposts: 12, replies: 8, bookmarks: 26, views: 4600 },
  },
  { id: 'herta', image: 'herta.png', text: 'ヘルタ #崩壊スターレイル', alt: '崩壊：スターレイルのヘルタのファンアート', ...author, source: 'https://x.com/sample_apricot/status/1002', postedAt: '2026/09/29 18:00', dateLabel: '9月29日', metrics: { likes: 312, reposts: 36, replies: 11, bookmarks: 52, views: 11200 } },
];
export const demoImages = demoPosts.map((post) => post.image);
