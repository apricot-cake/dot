import { ChevronDown, Search, Users, X } from 'lucide-react';
import { Avatar, PostCard, type PostCardModel } from '@/_shared/PostCard';
import { featurePosts } from '../data/demo';
import '../styles/feature.css';

export default function FeatureVisual({ mode, base, originImage, authorThumbnails }: { mode: 'origin' | 'organize' | 'authors'; base: string; authorThumbnails?: Record<string, string>; originImage?: { src: string; srcSet: string; width: number; height: number } }) {
  if (mode === 'authors') return <AuthorsVisual base={base} thumbnails={authorThumbnails} />;
  const post = featurePosts[mode];
  const image = base.replace(/\/$/, '') + '/demo/' + post.image;
  const work = post.workName;
  const character = post.characterName;
  const model: PostCardModel = {
    index: 0,
    selected: false,
    hasThumb: true,
    imgSrc: image,
    eager: false,
    userName: post.author,
    handle: post.handle,
    monogram: '',
    monoHue: post.avatarHue,
    flags: [],
    text: post.text,
    stats: {},
    footDates: { post: { label: post.dateLabel } },
    tags: [],
  };
  return mode === 'origin' ? (
    <div className="feature-window origin-visual" data-testid="feature-origin">
      <div className="origin-content">
        <img className="origin-image" src={originImage?.src ?? image} srcSet={originImage?.srcSet} sizes="180px" alt={post.alt} loading="lazy" decoding="async" width={originImage?.width ?? 2800} height={originImage?.height ?? 3595} />
        <div className="origin-info">
          <div className="feature-inspector-tabs">
            <span className="active">詳細</span>
            <span>タグ</span>
          </div>
          <p className="origin-post">{post.text}</p>
          <dl className="origin-fields">
            <div>
              <dt>サイト</dt>
              <dd>X</dd>
            </div>
            <div>
              <dt>作者</dt>
              <dd>
                <span className="origin-author">{post.author}</span>
              </dd>
            </div>
            <div>
              <dt>元URL</dt>
              <dd>{post.source.replace('https://', '')}</dd>
            </div>
            <div>
              <dt>投稿日</dt>
              <dd>{post.postedAt}</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  ) : (
    <div className="feature-window organize-visual" data-testid="feature-organize">
      <div className="organize-content">
        <div className="organize-results">
          <div className="feature-condition">
            <Search size={13} aria-hidden="true" />
            <span>{work}</span>
            <span>{character}</span>
          </div>
          <PostCard m={model} shape={{ info: true, avatar: true }} group={null} />
          <p className="feature-result-count">1件の投稿</p>
        </div>
        <div className="feature-tag-panel">
          <div className="feature-inspector-tabs">
            <span>詳細</span>
            <span className="active">タグ</span>
          </div>
          <div className="feature-field">
            <span className="feature-field-label">
              作品
              <X size={12} aria-hidden="true" />
            </span>
            <div>
              {work}
              <ChevronDown size={13} aria-hidden="true" />
            </div>
          </div>
          <div className="feature-field">
            <span>キャラ</span>
            <div>
              <span className="feature-assigned-chip">
                {character}
                <X size={11} aria-hidden="true" />
              </span>
              <ChevronDown size={13} aria-hidden="true" />
            </div>
          </div>
          <div className="feature-field feature-other-tags">
            <span>その他のタグ</span>
            <div className="feature-tag-search">
              <Search size={13} aria-hidden="true" />
              <span>タグを検索</span>
            </div>
            <p className="feature-assigned-chip">
              あとで見る
              <X size={11} aria-hidden="true" />
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function AuthorsVisual({ base, thumbnails }: { base: string; thumbnails?: Record<string, string> }) {
  const posts = featurePosts.authors;
  const author = posts[0];
  return (
    <div className="feature-window authors-visual" data-testid="feature-authors" role="group" aria-label="投稿者一覧からあんずの保存済み投稿を開いた状態">
      <div className="authors-list">
        <div className="authors-heading">
          <Users size={14} aria-hidden="true" />
          投稿者
        </div>
        <div className="authors-card" data-slot="poster-card">
          <Avatar c={{ monogram: '', monoHue: author.avatarHue }} className="authors-avatar" discClassName="authors-avatar-disc" />
          <div className="authors-card-meta">
            <strong>{author.author}</strong>
          </div>
        </div>
        {[
          { name: 'みずたま', hue: 205 },
          { name: 'こもれび', hue: 145 },
        ].map(({ name, hue }) => (
          <div key={name} className="authors-card authors-card-unselected" data-slot="poster-card">
            <Avatar c={{ monogram: '', monoHue: hue }} className="authors-avatar" discClassName="authors-avatar-disc" />
            <div className="authors-card-meta">
              <strong>{name}</strong>
            </div>
          </div>
        ))}
      </div>
      <div className="authors-posts">
        <div className="authors-grid">
          {posts.slice(0, 3).map((post, index) => (
            <div key={post.id} role="group" aria-label={post.alt}>
              <PostCard m={{ index, hasThumb: true, imgSrc: thumbnails?.[post.id] ?? `${base.replace(/\/$/, '')}/demo/${post.image}`, eager: false, flags: [], stats: {}, footDates: {}, tags: [] }} shape={{ info: false, avatar: false }} group={null} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
