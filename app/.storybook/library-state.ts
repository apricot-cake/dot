import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import type Database from 'better-sqlite3';
import { defaultLibraryDir, resolveAppStoragePaths } from '../../native-host/paths.mts';
import type { PostRecordShape, MediaItemShape } from '../../native-host/post-schemas.mts';
import { AppPrefsSchema, TabPersistSchema } from '../src/shared/data-schemas.ts';
import { postsFromDbSync, posterProfilesFromDb } from '../src/main/lib-db-query.ts';
import { createDbWriter } from '../src/main/lib-db-write.ts';
import { listTrashRecords } from '../src/main/lib-trash-capture.ts';
import { parseJsonLoose } from '../src/main/lib-json.ts';
import type { AppInfo, AppPrefs, ConfigSummary, ExportReminderState, ExtensionContactStatus, FoldersState, HistoryRow, IntegrityStatus, LibraryStatus, ManualGroupsState, PosterTagsState, PostsSnapshot, TabsState, TagGroupsState, TagVocabRow, UngroupedState } from '../src/main/ipc-payloads.ts';

// Electron 用のネイティブバイナリではなく、開発サーバーの Node 用を使う。
const Sqlite: typeof Database = createRequire(new URL('../../package.json', import.meta.url))('better-sqlite3');
const appPackage = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

export interface PreviewState {
  snapshot: PostsSnapshot;
  trash: PostRecordShape[];
  prefs: AppPrefs;
  config: ConfigSummary;
  folders: FoldersState;
  ungrouped: UngroupedState;
  groups: ManualGroupsState;
  tagGroups: TagGroupsState;
  posterTags: PosterTagsState;
  vocab: TagVocabRow[];
  tabs: TabsState | null;
  history: HistoryRow[];
  reminder: ExportReminderState;
  integrity: IntegrityStatus;
  appInfo: AppInfo;
  libraryStatus: LibraryStatus;
  extensionContact: ExtensionContactStatus;
}

function readConfig(directory: string): Record<string, unknown> {
  const file = path.join(directory, 'config.json');
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error('プレビュー用のアプリ設定を読み取れません。');
  }
  const value: unknown = parseJsonLoose(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('アプリ設定の形式が不正です。');
  return value as Record<string, unknown>;
}

function readTabs(sqlite: Database.Database): TabsState | null {
  // 通常の getTabs は旧形式を DB へ書き戻すため、ここでは同じ検証だけを行う。
  const rows = sqlite.prepare("SELECT id, pinned, title, state FROM tabs WHERE windowId = 'main' ORDER BY position").all() as Array<{ id: string; pinned: number; title: string; state: string }>;
  if (!rows.length) return null;
  const active = sqlite.prepare("SELECT activeTabId FROM tab_windows WHERE windowId = 'main'").get() as { activeTabId: string | null } | undefined;
  return {
    tabs: rows.map((row) => ({ id: row.id, pinned: !!row.pinned, title: row.title, state: TabPersistSchema.parse(JSON.parse(row.state)) })),
    activeTabId: active?.activeTabId || null,
  };
}

function reminderOf(value: unknown): ExportReminderState {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const threshold = typeof raw.threshold === 'number' && [25, 50, 100, 250].includes(raw.threshold) ? raw.threshold : 100;
  const changesSinceExport = typeof raw.changesSinceExport === 'number' && Number.isFinite(raw.changesSinceExport) ? Math.max(0, Math.floor(raw.changesSinceExport)) : 0;
  const enabled = raw.enabled !== false;
  return { enabled, threshold, changesSinceExport, lastExportAt: typeof raw.lastExportAt === 'string' ? raw.lastExportAt : null, due: enabled && changesSinceExport >= threshold };
}

function integrityOf(value: unknown): IntegrityStatus {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const count = (key: string) => (typeof raw[key] === 'number' && Number.isFinite(raw[key]) ? Math.max(0, Math.floor(raw[key])) : 0);
  return { lastCheckAt: typeof raw.lastCheckAt === 'string' ? raw.lastCheckAt : null, dbOk: typeof raw.dbOk === 'boolean' ? raw.dbOk : null, orphanCount: count('orphanCount'), missingCount: count('missingCount') };
}

function referencedFiles(state: PreviewState): Set<string> {
  const files = new Set<string>();
  const add = (file: string | null | undefined) => {
    if (file) files.add(file);
  };
  const mediaFiles = (media: MediaItemShape[]) => {
    for (const item of media) {
      add(item.file);
      add(item.posterFile);
      for (const frame of item.frames || []) add(frame.file);
    }
  };
  for (const post of [...state.snapshot.posts, ...state.trash]) {
    add(post.image);
    add(post.video);
    add(post.avatarFile);
    add(post.linkCard?.thumbnailFile);
    mediaFiles(post.media);
    mediaFiles(post.quotedPost?.media || []);
    mediaFiles(post.replyToPost?.media || []);
  }
  for (const profile of state.snapshot.profiles) {
    add(profile.avatarFile);
    add(profile.bannerFile);
  }
  return files;
}

export async function readPreviewState(configDirectory?: string): Promise<{ state: PreviewState; libraryRoot: string; files: Set<string> }> {
  const directory = configDirectory || resolveAppStoragePaths({ env: process.env, home: os.homedir(), packageData: null }).config;
  const config = readConfig(directory);
  const libraryRoot = path.resolve(typeof config.saveFolder === 'string' && config.saveFolder.trim() ? config.saveFolder : defaultLibraryDir());
  // 初期化・復旧・マイグレーションを行う通常のアプリ接続は使わない。
  const sqlite = new Sqlite(path.join(libraryRoot, 'dot.db'), { readonly: true, fileMustExist: true });
  let stored: Pick<PreviewState, 'snapshot' | 'folders' | 'ungrouped' | 'groups' | 'tagGroups' | 'posterTags' | 'vocab' | 'tabs' | 'history'>;
  try {
    sqlite.pragma('query_only = ON');
    sqlite.pragma('busy_timeout = 5000');
    stored = sqlite.transaction(() => {
      const reader = createDbWriter(sqlite);
      const history = (sqlite.prepare('SELECT id, ts, u, kind, title, state FROM history ORDER BY ts DESC, id DESC').all() as Array<Omit<HistoryRow, 'state'> & { state: string }>).map((row) => ({ ...row, state: JSON.parse(row.state) }));
      return {
        snapshot: { saveFolder: libraryRoot, posts: postsFromDbSync(sqlite), profiles: posterProfilesFromDb(sqlite) },
        folders: reader.getFolders(),
        ungrouped: reader.getUngrouped(),
        groups: reader.getManualGroups(),
        tagGroups: reader.getTagGroups(),
        posterTags: reader.getPosterTags(),
        vocab: reader.tagVocabOverview(),
        tabs: readTabs(sqlite),
        history,
      };
    })();
  } finally {
    sqlite.close();
  }
  const state: PreviewState = {
    ...stored,
    trash: await listTrashRecords(path.join(libraryRoot, '.trash')),
    prefs: AppPrefsSchema.parse(config),
    config: { saveFolder: libraryRoot, extensionId: typeof config.extensionId === 'string' ? config.extensionId : null },
    reminder: reminderOf(config.exportReminder),
    integrity: integrityOf(config.integrity),
    appInfo: { version: appPackage.version, electron: '—', chromium: '—', node: process.versions.node, os: `${process.platform} ${os.release()} ${process.arch}` },
    libraryStatus: { missing: false, path: libraryRoot },
    extensionContact: { contacted: fs.existsSync(path.join(directory, 'extension-contact.json')) },
  };
  return { state, libraryRoot, files: referencedFiles(state) };
}
