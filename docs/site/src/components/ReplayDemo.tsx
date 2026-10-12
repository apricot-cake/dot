import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import {
  Proportions,
  Calendar,
  Globe,
  Hash,
  Image,
  Layers,
  Tag,
  Shuffle,
  SquarePen,
  ArrowLeft,
  Bell,
  UserRound,
  MoreHorizontal,
  Share2,
  Download,
  LoaderCircle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ArrowDownWideNarrow,
  SlidersHorizontal,
  Settings,
  Plus,
  Folder,
  Heart,
  Repeat2,
  MessageCircle,
  Bookmark,
  Eye,
  History,
  House,
  PanelRight,
  Search,
  Trash2,
  Users,
} from 'lucide-react';
import { AuthorLine, PostCard, type PostCardModel } from '@/_shared/PostCard';
import { demoCopy, demoPosts, demoEngagement, STEP_MS, SEARCH_TIMING, SEARCH_START_MS, MENU_TIMING, type DemoPost } from '../data/demo';
import { CONTROL_SIZE, CONTROL_INSET } from '../../../../extension/utils/overlay/constants';
import { formatCount } from '@/services/format';
import '../styles/demo.css';

const TOTAL_MS = STEP_MS * demoCopy.steps.length;
const SOCIAL_ACTIONS = ['replies', 'reposts', 'likes', 'bookmarks'] as const;
const ENGAGEMENT_ICONS = { likes: Heart, reposts: Repeat2, replies: MessageCircle, bookmarks: Bookmark, views: Eye } as const;
type Point = { x: number; y: number };
const interpolate = (from: Point, to: Point, time: number, start: number, end: number): Point => {
  const fraction = Math.max(0, Math.min(1, (time - start) / (end - start)));
  const eased = fraction * fraction * (3 - 2 * fraction);
  return { x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased };
};
const normalized = (text: string) => text.normalize('NFKC').toLocaleLowerCase('ja-JP');

export default function ReplayDemo({ base }: { base: string }) {
  const c = demoCopy;
  const host = useRef<HTMLDivElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(true);
  const [cursorPoints, setCursorPoints] = useState<Record<string, Point>>({});
  const [menuOffsets, setMenuOffsets] = useState({ filter: 12, sort: 12 });
  const step = Math.min(c.steps.length - 1, Math.floor(elapsed / STEP_MS));
  const fraction = (elapsed % STEP_MS) / STEP_MS;
  const saved = step > 0 || fraction > 0.58;
  const running = visible && pageVisible && !keyboardFocus;
  const busy = step === 0 && fraction > 0.4 && fraction < 0.58;
  const toastVisible = step === 0 && (busy || (saved && fraction < 0.58 + 2000 / STEP_MS));
  const localMs = elapsed % STEP_MS;
  const phaseMs = localMs - SEARCH_START_MS;
  const menuPhase = step !== 2 ? 'idle' : localMs < MENU_TIMING.filterOpen ? 'filter-moving' : localMs < MENU_TIMING.filterClose ? 'filter-open' : localMs < MENU_TIMING.sortOpen ? 'sort-moving' : localMs < MENU_TIMING.sortClose ? 'sort-open' : 'closed';
  const cursorTarget = step === 0 ? '0' : step === 1 ? 'search' : localMs < MENU_TIMING.sortMove ? 'filter' : 'sort';
  const cursorVisible = !!cursorPoints[cursorTarget] && (step !== 1 || localMs >= SEARCH_START_MS);
  const point = (name: string): Point => cursorPoints[name] ?? { x: 0, y: 0 };
  const searchPoint = point('search');
  let cursor: Point;
  if (step === 0) cursor = interpolate({ x: point('0').x + 80, y: point('0').y + 60 }, point('0'), localMs, 800, 2000);
  else if (step === 1) cursor = interpolate({ x: searchPoint.x - 60, y: searchPoint.y + 40 }, searchPoint, phaseMs, 0, SEARCH_TIMING.moveEnd);
  else if (localMs < MENU_TIMING.sortMove) cursor = interpolate(searchPoint, point('filter'), localMs, 0, MENU_TIMING.filterOpen - 100);
  else cursor = interpolate(point('filter'), point('sort'), localMs, MENU_TIMING.sortMove, MENU_TIMING.sortOpen - 100);
  const searchFocused = step === 1 && phaseMs >= SEARCH_TIMING.click;
  const typingProgress = Math.max(0, Math.min(1, (phaseMs - SEARCH_TIMING.typeStart) / (SEARCH_TIMING.typeEnd - SEARCH_TIMING.typeStart)));
  const queryLength = phaseMs < SEARCH_TIMING.typeStart ? 0 : Math.min(c.imeQuery.length, 1 + Math.floor(typingProgress * (c.imeQuery.length - 1)));
  const composingText = reducedMotion ? c.imeQuery : c.imeQuery.slice(0, queryLength);
  const query = step === 2 ? c.query : step !== 1 || phaseMs < SEARCH_TIMING.typeStart ? '' : phaseMs < SEARCH_TIMING.convert ? composingText : c.query;
  const appliedQuery = step === 2 || (step === 1 && phaseMs >= SEARCH_TIMING.results) ? c.query : '';
  const searchPhase = step === 2 ? 'results' : step !== 1 ? 'idle' : phaseMs < SEARCH_TIMING.click ? 'moving' : phaseMs < SEARCH_TIMING.typeStart ? 'focused' : phaseMs < SEARCH_TIMING.convert ? 'composing' : phaseMs < SEARCH_TIMING.commit ? 'converted' : phaseMs < SEARCH_TIMING.results ? 'committed' : 'results';
  const clickPulse =
    step === 2 ? [MENU_TIMING.filterOpen, MENU_TIMING.filterClose, MENU_TIMING.sortOpen, MENU_TIMING.sortClose].some((time) => localMs >= time && localMs < time + 350) : step === 1 ? phaseMs >= SEARCH_TIMING.click && phaseMs < SEARCH_TIMING.click + 400 : fraction >= 0.4 && fraction < 0.4 + 350 / STEP_MS;
  const posts = demoPosts.filter((post) => normalized(post.text).includes(normalized(appliedQuery)));
  const target = demoPosts[0];
  const asset = (name: string) => `${base.replace(/\/$/, '')}/demo/${name}`;

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const motion = () => setReducedMotion(media.matches);
    motion();
    media.addEventListener('change', motion);
    const visibility = () => setPageVisible(document.visibilityState === 'visible');
    visibility();
    document.addEventListener('visibilitychange', visibility);
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0 });
    if (host.current) observer.observe(host.current);
    setReady(true);
    return () => {
      media.removeEventListener('change', motion);
      document.removeEventListener('visibilitychange', visibility);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!running) return;
    let frame = 0;
    let previous: number | undefined;
    const tick = (now: number) => {
      if (previous !== undefined) {
        const delta = now - previous;
        setElapsed((value) => (value + delta) % TOTAL_MS);
      }
      previous = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running]);

  useLayoutEffect(() => {
    const surface = screen.current;
    if (!surface) return;
    const targets = [...surface.querySelectorAll<HTMLElement>(step === 0 ? '[data-demo-target="0"]' : '[data-demo-target]')];
    const update = () => {
      const bounds = surface.getBoundingClientRect();
      const positions: Record<string, Point> = {};
      for (const targetElement of targets) {
        const name = targetElement.dataset.demoTarget;
        if (!name) continue;
        const destination = targetElement.getBoundingClientRect();
        positions[name] = { x: destination.left - bounds.left - surface.clientLeft + (name === 'search' ? 33 : destination.width / 2), y: destination.top - bounds.top - surface.clientTop + destination.height / 2 };
      }
      setCursorPoints(positions);
      const toolbar = surface.querySelector('.demo-toolbar')?.getBoundingClientRect();
      if (toolbar) {
        const offset = (name: string) => {
          const anchor = surface.querySelector<HTMLElement>(`[data-demo-target="${name}"]`);
          return anchor ? Math.max(12, toolbar.right - anchor.getBoundingClientRect().right) : 12;
        };
        setMenuOffsets({ filter: offset('filter'), sort: offset('sort') });
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(surface);
    for (const targetElement of targets) observer.observe(targetElement);
    return () => observer.disconnect();
  }, [step]);

  const jump = (index: number) => {
    setElapsed(index * STEP_MS);
  };
  const model = (post: DemoPost): PostCardModel => ({
    index: demoPosts.indexOf(post),
    selected: post.id === target.id,
    hasThumb: true,
    imgSrc: asset(post.image),
    eager: true,
    userName: post.author,
    handle: post.handle,
    monogram: '',
    monoHue: 28,
    flags: [],
    text: post.text,
    stats: {},
    footDates: { post: { label: post.dateLabel } },
    tags: [],
  });

  return (
    <div
      ref={host}
      className="dot-demo"
      data-testid="replay-demo"
      data-ready={ready}
      data-step={step}
      data-search-phase={searchPhase}
      data-menu-phase={menuPhase}
      data-cursor-target={cursorTarget}
      data-applied-query={appliedQuery}
      data-typed-query={query}
      data-playing={running}
      data-elapsed={Math.round(elapsed)}
      data-reduced-motion={reducedMotion}
      onPointerDownCapture={() => setKeyboardFocus(false)}
      onFocusCapture={(event) => setKeyboardFocus(event.target.matches(':focus-visible'))}
      onKeyDownCapture={(event) => {
        if (event.target instanceof HTMLElement && event.target.matches(':focus-visible')) setKeyboardFocus(true);
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setKeyboardFocus(false);
      }}
    >
      <div className="demo-timeline-wrap">
        <ol className="demo-timeline" aria-label="デモの工程">
          {c.steps.map((label, index) => (
            <li key={label}>
              <button type="button" className="demo-step" data-testid={`replay-step-${index}`} onClick={() => jump(index)} aria-current={step === index ? 'step' : undefined}>
                <span className="demo-step-label">{label}</span>
                <span className="demo-step-track" aria-hidden="true">
                  <span style={{ transform: `scaleX(${index < step ? 1 : index === step ? fraction : 0})` }} />
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>
      <div ref={screen} className="demo-screen" data-step={step}>
        {step === 0 ? (
          <div className="demo-browser-scene">
            <aside className="demo-social-nav" aria-label="Xのナビゲーション">
              {[
                [House, 'ホーム'],
                [Search, '話題を検索'],
                [Bell, '通知'],
                [Bookmark, 'ブックマーク'],
                [UserRound, 'プロフィール'],
              ].map(([Icon, label]) => {
                const Glyph = Icon as typeof House;
                return (
                  <span className="demo-social-nav-item" role="img" aria-label={String(label)} key={String(label)}>
                    <Glyph size={20} aria-hidden="true" />
                  </span>
                );
              })}
            </aside>
            <div className="demo-social-feed">
              <div className="demo-social-header">
                <ArrowLeft size={18} aria-hidden="true" />
                <strong>ポスト</strong>
              </div>
              <div className="demo-social-post">
                <AuthorLine userName={target.author} handle={target.handle} avatar={{ monogram: '', monoHue: 28 }} />
                <MoreHorizontal className="demo-social-more" size={19} aria-hidden="true" />
                <p>{target.text}</p>
                <div className="demo-post-media">
                  <img src={asset(target.image)} alt={target.alt} width="640" height="640" />
                  <span className="demo-save-control" style={{ width: CONTROL_SIZE, height: CONTROL_SIZE, left: CONTROL_INSET, top: CONTROL_INSET }} data-demo-target="0" role="img" aria-label={saved ? c.saved : busy ? c.saving : c.save}>
                    {saved ? <Check size={14} aria-hidden="true" /> : busy ? <LoaderCircle size={14} className="demo-save-spinner" aria-hidden="true" /> : <Download size={14} aria-hidden="true" />}
                  </span>
                </div>
                <div className="demo-social-date">
                  <span>{target.postedAt}</span>
                  <span>
                    <Eye size={13} aria-hidden="true" />
                    {formatCount(target.metrics.views)}件の表示
                  </span>
                </div>
                <div className="demo-social-actions">
                  {SOCIAL_ACTIONS.map((kind) => {
                    const Icon = ENGAGEMENT_ICONS[kind];
                    const label = demoEngagement.find((item) => item.kind === kind)?.label;
                    return (
                      <span key={kind} role="group" aria-label={`${label}: ${formatCount(target.metrics[kind])}`}>
                        <Icon size={17} aria-hidden="true" />
                        {formatCount(target.metrics[kind])}
                      </span>
                    );
                  })}
                  <Share2 size={16} aria-hidden="true" />
                </div>
              </div>
            </div>
            {toastVisible && (
              <div className="demo-save-toast" data-state={busy ? 'busy' : 'success'} aria-hidden="true">
                <span className="demo-toast-badge">{busy ? <LoaderCircle size={15} className="demo-save-spinner" /> : <Check size={15} />}</span>
                <span>{busy ? c.saving : c.saved}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="demo-app-scene">
            <div className="demo-app-tabs">
              <span className="demo-active-tab">
                <House size={13} aria-hidden="true" />
                {c.posts}
              </span>
              <Plus className="demo-tab-add" size={13} aria-hidden="true" />
            </div>
            <aside className="demo-sidebar" aria-label={c.library}>
              <div className="demo-sidebar-item selected">
                <House size={17} aria-hidden="true" />
                <span>{c.posts}</span>
              </div>
              {[
                [Users, c.posters],
                [Folder, c.folders],
                [Trash2, c.trash],
                [History, c.history],
              ].map(([Icon, label]) => {
                const Glyph = Icon as typeof Folder;
                return (
                  <div className="demo-sidebar-item" key={String(label)}>
                    <Glyph size={17} aria-hidden="true" />
                    <span>{String(label)}</span>
                  </div>
                );
              })}
              <div className="demo-sidebar-item demo-settings">
                <Settings size={17} aria-hidden="true" />
                <span>{c.settings}</span>
              </div>
            </aside>
            <div className="demo-toolbar">
              <span className="demo-history-arrows">
                <ChevronLeft size={15} aria-hidden="true" />
                <ChevronRight size={15} aria-hidden="true" />
              </span>
              <div className="demo-search" data-focused={searchFocused} data-demo-target="search">
                <Search size={16} aria-hidden="true" />
                <span className="demo-search-value" data-composing={step === 1 && phaseMs >= SEARCH_TIMING.typeStart && phaseMs < SEARCH_TIMING.commit} data-testid="replay-query">
                  {query}
                  {searchFocused && !reducedMotion && <span className="demo-typing-caret" aria-hidden="true" />}
                </span>
                {!query && !searchFocused && (
                  <span className="demo-search-placeholder" aria-hidden="true">
                    {c.search}
                  </span>
                )}
              </div>
              <span className="demo-toolbar-action" data-demo-target="filter">
                <SlidersHorizontal size={14} aria-hidden="true" />
                {c.filter}
              </span>
              <span className="demo-toolbar-action demo-sort" data-demo-target="sort">
                <ArrowDownWideNarrow size={14} aria-hidden="true" />
                {c.sortDate}
                <ChevronDown size={12} aria-hidden="true" />
              </span>
              <span className="demo-toolbar-action demo-details-toggle">
                <PanelRight size={14} aria-hidden="true" />
                {c.details}
              </span>
              {step === 2 && (menuPhase === 'filter-open' || menuPhase === 'sort-open') && (
                <div className="demo-menu-preview" role="group" aria-label={menuPhase === 'filter-open' ? 'フィルタの選択肢' : 'ソートの選択肢'} data-testid="replay-menu" style={{ insetInlineEnd: menuPhase === 'filter-open' ? menuOffsets.filter : menuOffsets.sort }}>
                  {menuPhase === 'filter-open' ? (
                    <>
                      {[
                        [Layers, 'ソース'],
                        [Globe, 'サイト'],
                        [MessageCircle, '投稿の種類'],
                        [Image, 'メディア'],
                        [Proportions, '縦横比'],
                        [Tag, 'タグ'],
                        [Hash, 'ハッシュタグ'],
                        [Users, '投稿者'],
                        [Folder, 'フォルダ'],
                        [Calendar, '日付'],
                      ].map(([Icon, label]) => {
                        const Glyph = Icon as typeof Tag;
                        return (
                          <div className="demo-menu-row" key={String(label)}>
                            <Glyph size={14} aria-hidden="true" />
                            <span>{String(label)}</span>
                            <ChevronRight size={12} aria-hidden="true" />
                          </div>
                        );
                      })}
                      <div className="demo-menu-separator" />
                      <div className="demo-menu-row">すべて解除</div>
                    </>
                  ) : (
                    <>
                      {[
                        [SquarePen, '投稿日'],
                        [Download, '保存日'],
                        [Eye, '閲覧数'],
                        [History, '閲覧日'],
                        [Heart, 'いいね数'],
                        [Shuffle, 'ランダム'],
                      ].map(([Icon, label], index) => {
                        const Glyph = Icon as typeof Tag;
                        return (
                          <div className="demo-menu-row" key={String(label)}>
                            <span className="demo-menu-check">{index === 0 && <Check size={12} aria-hidden="true" />}</span>
                            <Glyph size={14} aria-hidden="true" />
                            <span>{String(label)}</span>
                          </div>
                        );
                      })}
                      <div className="demo-menu-separator" />
                      <div className="demo-menu-row">
                        <span className="demo-menu-check">
                          <Check size={12} aria-hidden="true" />
                        </span>
                        新しい順
                      </div>
                      <div className="demo-menu-row">
                        <span className="demo-menu-check" />
                        古い順
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="demo-main">
              <div className="demo-grid" data-filtered={!!appliedQuery}>
                <div className="demo-masonry">
                  {posts.map((post) => (
                    <div key={post.id} className="demo-card-wrap" role="figure" aria-label={post.alt} data-post-id={post.id}>
                      <PostCard m={model(post)} shape={{ info: true, avatar: true }} group={null} />
                    </div>
                  ))}
                </div>
              </div>
              <div className="demo-statusbar" data-testid="replay-results">
                {posts.length}件の投稿
              </div>
            </div>
            <aside className="demo-inspector" data-demo-target="info">
              <div className="demo-inspector-tabs">
                <span className="active">{c.details}</span>
                <span>{c.tags}</span>
              </div>
              <AuthorLine userName={target.author} handle={target.handle} avatar={{ monogram: '', monoHue: 28 }} />
              <p className="demo-post-text" data-testid="replay-saved-text">
                {target.text}
              </p>
              <img className="demo-detail-thumb" src={asset(target.image)} alt={target.alt} width="640" height="640" />
              <dl className="demo-metadata">
                <div>
                  <dt>{c.source}</dt>
                  <dd>{target.source.replace('https://', '')}</dd>
                </div>
                <div className="demo-metadata-engagement">
                  <dt>{c.engagement}</dt>
                  <dd>
                    <span className="demo-engagement" data-testid="replay-engagement">
                      {demoEngagement.map(({ kind, label }) => {
                        const Icon = ENGAGEMENT_ICONS[kind];
                        const value = formatCount(target.metrics[kind]);
                        return (
                          <span key={kind} role="group" data-metric={kind} aria-label={`${label}: ${value}`}>
                            <Icon size={14} aria-hidden="true" />
                            <span>{value}</span>
                          </span>
                        );
                      })}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>{c.posted}</dt>
                  <dd>{target.postedAt}</dd>
                </div>
              </dl>
            </aside>
          </div>
        )}
        <span className="demo-cursor" data-visible={cursorVisible} data-typing={step === 1 && phaseMs >= SEARCH_TIMING.typeStart} aria-hidden="true" style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)` } as CSSProperties}>
          <span className="demo-cursor-ring" />
          <span className="demo-cursor-click" data-click={clickPulse} />
        </span>
      </div>
    </div>
  );
}
