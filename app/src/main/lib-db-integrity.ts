'use strict';

// DB とメディアの相互突き合わせ (#5 St8 / #301)。DB ファイル1本の構成が離れていきうる
// 方向は2つある。
//   - 孤児メディア: ファイルはディスクに残っているのに、その posts の行が無い（DB の
//     喪失、あるいは DB から復元できる痕跡を残さない書き込み経路＝下を参照）。その
//     キャプチャ自身の <captureId>.json が隣に転がっていればそこから回収し、無い場合に
//     限って最小限のレコードを合成する。
//   - 欠落メディア: posts の行は残っているのに、そのファイルが無い（アプリの外で誤って
//     消した、同期クライアントがまだ追いついていない）。報告するだけ＝合成できる
//     ファイルは存在しない。
//
// これは #100（ライブラリ健全性のダッシュボード）が作り直すのではなく呼ぶための、共有の
// 検出 (#301 の設計コメント「検出の仕掛けは #100 の項目1と共有し、実装を二重に持たない」)。
//
// #299 の取込キュー再生による回収があるのに、それでも孤児メディアが出る理由。
// ipc-transfer.ts の ZIP 取り込みとドラッグ取り込みのハンドラは writePost
// (lib-db-record-writer.ts) で posts を直接書き、サイドカー（通常の保存はもう書かない＝
// bridge.mts の handleSave を参照）と取込キューの両方を通らない（そちらのコメント
// 「気づく材料になるサイドカーも inbox イベントも無い」）。DB を失うと、それらの
// メディアファイルには再生できる痕跡が何も残らない。captureId 自身の命名規約
// （epochMillis-hex、native-host/bridge.mts の SAFE_ID）だけが取り戻せる事実であり、
// だから「最小限のレコードの合成」になる。
//
// Electron 非依存（better-sqlite3 と node の組み込みだけ）で、lib-db-inbox.ts に倣う。

import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { PostRecordShape } from '../../../native-host/post-record.mts';
import { normalizePostRecord, recordHoldsContent } from '../../../native-host/post-record.mts';
import { z } from 'zod';
import { missingMediaReason } from './lib-db-inbox.ts';
import { resolveInSaveFolder } from './lib-save-folder-path.ts';
import { fillCardDims } from './lib-card-dims.ts';
import { fillMediaDims } from './lib-media-dims.ts';
import { makeTagResolver, preparePostStmts, writePost } from './lib-db-record-writer.ts';
import { parseJsonLoose } from './lib-json.ts';
import { ITEMS_SUBDIR, parseItemFilePath } from '../../../native-host/item-storage.mts';
import { IMPORTABLE_MEDIA } from '../../../native-host/importable-media.mts';
import { STORED_CAPTURE_ID_PATTERN } from '../../../native-host/capture-id.mts';

// native-host/bridge.mts の SAFE_ID の写し＝どの書き手も裸のファイル名の基部
// (<captureId>.<ext>) として書く captureId の形。付属メディアのファイル
// (<base>-media-N.<ext>、<base>-poster.<ext>) はこれ単独には一致しないので、孤児の投稿
// 自身の主たる成果物と取り違えられることがない。
const SAFE_ID = STORED_CAPTURE_ID_PATTERN;

const TRASH_SUBDIR = '.trash';
const AVATAR_SUBDIR = 'avatars';
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov']);

interface OrphanMedia {
  captureId: string;
  file: string; // saveFolder からの相対のファイル名
  files?: string[]; // 項目フォルダーが持つ実体。DB喪失時に複数メディアをまとめて回収する。
}
interface MissingMedia {
  captureId: string;
  file: string;
}
// 孤児がどうやって posts の行を取り戻したか＝recoverOrphanRecords を参照。
interface RecoveredOrphan extends OrphanMedia {
  via: 'sidecar' | 'synthesized';
}

// 旧構造の直下ファイルと、現行構造の items/<captureId>/ を列挙する。共有リソース、
// ごみ箱、内部データは投稿の実体ではないので辿らない。
function listOwnedFiles(saveFolder: string): string[] {
  let names: fs.Dirent[] = [];
  try {
    names = fs.readdirSync(saveFolder, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of names) {
    const name = entry.name;
    if (name === TRASH_SUBDIR || name === AVATAR_SUBDIR || name === ITEMS_SUBDIR) continue;
    if (name.startsWith('.')) continue; // .dot-inbox、.trash、ドット始まりのファイル
    if (/\.tmp(-\d+)?$/i.test(name)) continue;
    try {
      if (entry.isFile() || (entry.isSymbolicLink() && fs.statSync(path.join(saveFolder, name)).isFile())) out.push(name);
    } catch {
      /* 触れないエントリは飛ばす */
    }
  }
  let itemKeys: fs.Dirent[] = [];
  try {
    itemKeys = fs.readdirSync(path.join(saveFolder, ITEMS_SUBDIR), { withFileTypes: true });
  } catch {
    itemKeys = [];
  }
  for (const item of itemKeys) {
    if (!item.isDirectory() && !item.isSymbolicLink()) continue;
    const itemKey = item.name;
    let files: fs.Dirent[] = [];
    try {
      files = fs.readdirSync(path.join(saveFolder, ITEMS_SUBDIR, itemKey), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of files) {
      const file = entry.name;
      const rel = `${ITEMS_SUBDIR}/${itemKey}/${file}`;
      if (!parseItemFilePath(rel)) continue;
      try {
        if (entry.isFile() || (entry.isSymbolicLink() && fs.statSync(path.join(saveFolder, ITEMS_SUBDIR, itemKey, file)).isFile())) out.push(rel);
      } catch {
        /* 触れないエントリは飛ばす */
      }
    }
  }
  return out;
}

// 直下の <captureId>.json はそのキャプチャのレコードであって、そのメディアファイルの
// 1つでは決してない。#302 以降これを書くものは無いが、ライブラリはまだ持ちうる＝#302 より
// 前の保存は必ず1つ残したし、#299 より古い native-host のバンドルは今も作り続ける
// (#511: あの Issue が報告した孤児2件はこうしてできた。取込キューより前の bridge.js が
// 配備されたまま、アプリ側はすでにサイドカーを読むのをやめていた)。この2つを取り違え
// ないことは、二重に効く:
//   - メディアとして数えると、サイドカーが孤児自身の「ファイル」になり、回収は image が
//     .json を指すレコードを書く。そのレコードが記述している mp4 とポスターは、誰からも
//     参照されないまま残る。
//   - レコードとして読むと、これは完全な投稿そのもの（url・text・author・media[]）で、
//     合成が捻り出せるどんなものより確実に良い。
function isSidecarName(name: string): boolean {
  return name.toLowerCase().endsWith('.json');
}

// 孤児の報告でこのレコードを代表する1ファイル＝レンダラーのカードの面が解決するのと
// 同じ image → video → media[] の順に見た、そのレコード自身の表示用の成果物
// (records.ts の artworkFile)。
function primaryArtifactOf(record: PostRecordShape): string | null {
  if (record.image) return record.image;
  if (record.video) return record.video;
  for (const m of record.media) if (m.file) return m.file;
  return null;
}

// URL だけの旧サイドカーも取得不足として回復する。参照するメディアがある場合は
// 取込キューと同じ存在確認を行う。
//
// captureId は孤児自身の基部で上書きする。これらのファイルを結び付けている事実は
// ファイル名であって、手で編集されたかもしれない・どこかから写されたかもしれない
// ファイルの中の欄ではない。trashedAt を消すのも同じ理由＝これらのファイルはライブラリ
// 直下にあり、そこは生きているキャプチャのファイルが在る場所（ゴミ箱行きのものは
// .trash/ の下）。つまりディスクが印と食い違っていて、そもそも回収しているのはディスクを
// 根拠にしている。ipc-trash.ts の restore-post が posts の行を作り直すときに trashedAt を
// 落とすのも、まさにこの理由。
function readSidecarRecord(saveFolder: string, captureId: string): PostRecordShape | null {
  let parsed: unknown;
  try {
    parsed = parseJsonLoose(fs.readFileSync(path.join(saveFolder, `${captureId}.json`), 'utf8'));
  } catch {
    return null; // 無い・読めない・JSON でない＝代わりに合成へ回る
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  let record: PostRecordShape;
  try {
    record = normalizePostRecord({ ...(parsed as Record<string, unknown>), captureId, trashedAt: null });
  } catch {
    // 一件の不正な旧レコードで、他の孤児と欠落メディアの検査を止めない。
    return null;
  }
  if (!recordHoldsContent(record)) {
    if (!z.url({ protocol: /^https?$/ }).safeParse(record.url).success) return null;
    record.saveIncomplete = true;
  }
  if (missingMediaReason(saveFolder, record)) return null;
  return record;
}

// 管理対象の保存領域にファイルが在って posts の行が1つも無いキャプチャ（ゴミ箱行きの投稿は
// 行を持ったまま＝行が無いのではなく trashedAt が立っているだけなので、特別扱いなしに
// 正しく外れる）。captureId ごとに1エントリで、キーはどの書き手も書く基部の名前＝裸の
// captureId のメディアファイルか、自分でメディアの名前を持つ裸の <captureId>.json
// サイドカー。
// `knownFiles` は、すでにフォルダを列挙し終えた呼び出し元が
// readdir を省くためのもの＝設計が言う「相乗り」。
function findOrphanMedia(saveFolder: string, sqlite: Database.Database, knownFiles?: Set<string>): OrphanMedia[] {
  const files = knownFiles ? [...knownFiles] : listOwnedFiles(saveFolder);
  const hasPost = sqlite.prepare('SELECT 1 FROM posts WHERE captureId = ?');
  const referenced = new Set((sqlite.prepare('SELECT file FROM media UNION SELECT posterFile AS file FROM media UNION SELECT image AS file FROM posts UNION SELECT video AS file FROM posts').all() as Array<{ file: string | null }>).map((m) => m.file));
  // 報告する `file` は、サイドカーよりメディアを優先する。両方が残っているとき、
  // 「孤児メディア」の報告が名指すべきなのはメディアの方だから。
  const byBase = new Map<string, { media: string | null; sidecar: boolean; files: string[] }>();
  for (const file of files) {
    const item = parseItemFilePath(file);
    if (item) {
      const entry = byBase.get(item.captureId) || { media: null, sidecar: false, files: [] };
      entry.files.push(file);
      const stem = path.basename(item.file, path.extname(item.file));
      if (!entry.media || stem === item.captureId || /-media-0$/.test(stem)) entry.media = file;
      byBase.set(item.captureId, entry);
      continue;
    }
    const base = file.replace(/\.[^.]+$/, '');
    if (!SAFE_ID.test(base)) continue;
    const entry = byBase.get(base) || { media: null, sidecar: false, files: [] };
    if (isSidecarName(file)) entry.sidecar = true;
    else if (!entry.media) entry.media = file;
    byBase.set(base, entry);
  }
  const out: OrphanMedia[] = [];
  for (const [captureId, entry] of byBase) {
    if (hasPost.get(captureId) || entry.files.some((file) => referenced.has(file)) || (entry.media && referenced.has(entry.media))) continue;
    if (entry.media) {
      out.push({ captureId, file: entry.media, ...(entry.files.length ? { files: entry.files.slice().sort() } : {}) });
      continue;
    }
    if (!entry.sidecar) continue;
    // 裸の captureId のメディアファイルを持たないサイドカー。動画や一括取り込みの
    // 保存は、メディアを <captureId>-media-N.<ext> として持つ。listRootFiles は意図して
    // それを独立した投稿として扱わない。その名前を知っているのはレコードだけなので、
    // 読まなければそのキャプチャは孤児として一切報告されない。そして、そもそも
    // ユーザーを回収へ導くのはこの報告。
    const record = readSidecarRecord(saveFolder, captureId);
    const file = record && (primaryArtifactOf(record) || `${captureId}.json`);
    if (file) out.push({ captureId, file });
  }
  return out;
}

// image/video/media[].file が saveFolder の下に無い posts の行（ゴミ箱行きは除く＝
// ゴミ箱行きの投稿のメディアは物理的に .trash/ へ移してあるので、生存領域を見て判定すると
// 偽陽性になる）。
function findMissingMedia(saveFolder: string, sqlite: Database.Database, knownFiles?: Set<string>): MissingMedia[] {
  const out: MissingMedia[] = [];
  const posts = sqlite.prepare('SELECT captureId, image, video FROM posts WHERE trashedAt IS NULL').all() as Array<{ captureId: string; image: string | null; video: string | null }>;
  const mediaByPost = new Map<string, string[]>();
  for (const m of sqlite.prepare('SELECT m.postId, m.file FROM media m JOIN posts p ON p.captureId = m.postId WHERE p.trashedAt IS NULL ORDER BY m.postId, m.seq').all() as Array<{ postId: string; file: string }>) {
    let files = mediaByPost.get(m.postId);
    if (!files) mediaByPost.set(m.postId, (files = []));
    files.push(m.file);
  }
  const existing = knownFiles && new Set([...knownFiles].map((file) => path.resolve(saveFolder, file)));
  const checked = new Map<string, boolean>();
  for (const p of posts) {
    const files = [p.image, p.video, ...(mediaByPost.get(p.captureId) || [])].filter((f): f is string => !!f);
    for (const f of files) {
      const resolved = resolveInSaveFolder(saveFolder, f);
      if (!resolved) {
        out.push({ captureId: p.captureId, file: f });
        continue;
      }
      let present = checked.get(resolved);
      if (present === undefined) {
        present = existing?.has(resolved) || fs.existsSync(resolved);
        checked.set(resolved, present);
      }
      if (!present) out.push({ captureId: p.captureId, file: f });
    }
  }
  return out;
}

function checkOrphans(saveFolder: string, sqlite: Database.Database, knownFiles?: Set<string>): { orphanMedia: OrphanMedia[]; missingMedia: MissingMedia[] } {
  const files = knownFiles || new Set(listOwnedFiles(saveFolder));
  return { orphanMedia: findOrphanMedia(saveFolder, sqlite, files), missingMedia: findMissingMedia(saveFolder, sqlite, files) };
}

// captureId 自身の時刻の接頭辞 (epochMillis-hex)＝サイドカーも取込キューの痕跡も一切
// 無い状態で取り戻せる、唯一の事実。接頭辞が解析できないか、Date の表現範囲を
// 外れるときは「今」に退避する。ZIP など外から入るファイル名は SAFE_ID の形でも、
// その数値が JavaScript Date に変換できるとは限らない。
function capturedAtFromId(captureId: string): string {
  const m = captureId.match(SAFE_ID);
  const ms = m ? Number(m[1]) : NaN;
  const capturedAt = new Date(ms);
  return Number.isFinite(capturedAt.getTime()) ? capturedAt.toISOString() : new Date().toISOString();
}

// 孤児のメディアファイルすべてに posts の行を返し、また見える投稿に戻す。入口は2つで、
// その順序こそが要 (#511):
//
//   'sidecar'     — ファイルの隣に <captureId>.json が転がっていて、本物のレコードとして
//                   読める。そのまま採る＝url・text・author・エンゲージ数・media[]・タグ
//                   が全部生き残る。合成はそのどれ1つ復元できないので、使えるサイドカー
//                   があるのに合成で上書きする回収は、修復の顔をした喪失になる。
//   'synthesized' — 使えるサイドカーが無い。最小限のレコード＝captureId、拡張子で
//                   image/video のどちらかに入れたファイル本体、そして id から読み取った
//                   capturedAt。「取り込み画像」として現れ (url が null のままなので
//                   kind=image＝i18n.ts の kindImage を参照)、source:'orphan-recovery' が
//                   出所を印す。#301 が想定したのがこの場合＝ZIP 取り込み
//                   とドラッグ取り込みのハンドラは writePost で posts を直接書き、
//                   サイドカーも取込キューのエンベロープも残さない。
//
// 手動でしか起動しない (ipc-backup.ts の run-orphan-recovery に付いた #301 の設計コメント
// を参照)。起動時とバックアップ時の自動の整合確認からは決して呼ばない。だから、まだ
// 途中の保存（メディアは書けたが DB の書き込みはまだコミットされていない）が、恒久的な
// 喪失と読み違えられることがない。この決定はサイドカーの採用にも及ぶ (2026-07-30)。
// ライブラリ直下はライブラリ自身の保管場所であって、取り込みの受け口ではない。
// 受け口として扱えば、起動のたびにそこにあるファイルを何でも取り込むことになる。
function recoverOrphanRecords(saveFolder: string, sqlite: Database.Database): RecoveredOrphan[] {
  const orphans = findOrphanMedia(saveFolder, sqlite);
  if (!orphans.length) return [];
  const stmts = preparePostStmts(sqlite);
  const resolveTagId = makeTagResolver(sqlite);
  const written: RecoveredOrphan[] = [];
  sqlite.exec('BEGIN');
  try {
    for (const o of orphans) {
      const adopted = readSidecarRecord(saveFolder, o.captureId);
      const itemFiles = o.files || [];
      const exact = itemFiles.find((file) => path.basename(file, path.extname(file)) === o.captureId) || (itemFiles.length ? null : o.file);
      const primary = exact || o.file;
      const ext = path.extname(primary).slice(1).toLowerCase();
      const isVideo = VIDEO_EXTS.has(ext);
      const isMedia = IMPORTABLE_MEDIA.includes(ext);
      const media = itemFiles
        .filter((file) => /-media-\d+\.[^.]+$/i.test(path.basename(file)) && IMPORTABLE_MEDIA.includes(path.extname(file).slice(1).toLowerCase()))
        .sort((a, b) => Number(/-media-(\d+)/i.exec(a)?.[1] || 0) - Number(/-media-(\d+)/i.exec(b)?.[1] || 0))
        .map((file) => ({ file, url: '' }));
      if (!adopted && exact && !isMedia && !media.length) continue;
      const record =
        adopted ||
        normalizePostRecord({
          captureId: o.captureId,
          image: exact && isMedia && !isVideo ? exact : null,
          video: exact && isVideo ? exact : null,
          media,
          capturedAt: capturedAtFromId(o.captureId),
          source: 'orphan-recovery',
        });
      writePost(stmts, resolveTagId, fillMediaDims(saveFolder, fillCardDims(saveFolder, record)));
      written.push({ ...o, via: adopted ? 'sidecar' : 'synthesized' });
    }
    sqlite.exec('COMMIT');
  } catch (err) {
    sqlite.exec('ROLLBACK');
    throw err;
  }
  return written;
}

export { checkOrphans, findOrphanMedia, findMissingMedia, recoverOrphanRecords, readSidecarRecord, capturedAtFromId, SAFE_ID };
export type { OrphanMedia, MissingMedia, RecoveredOrphan };
