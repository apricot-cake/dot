import { toast } from 'sonner';
import { PostRecordSchema } from '../../native-host/post-schemas.mts';
import type { DotPreload } from '../src/preload/index.ts';
import type { FullTextHit } from '../src/main/ipc-payloads.ts';
import type { PreviewState } from './library-state.ts';

const clone = <T>(value: T): T => structuredClone(value);
const readOnlyMessage = 'このプレビューは読み取り専用です。変更はデスクトップアプリで行ってください。';
const unavailableMessage = 'この操作はブラウザのプレビューでは実行できません。';
const refuseWrite = async () => {
  toast.info(readOnlyMessage);
  return { ok: false };
};

// 主プロセスの代わりに、開発サーバーが読み取った実ライブラリのスナップショットを渡す。
// 変更系 API からサーバーへのリクエストは行わない。
export async function installLibraryPreload(): Promise<void> {
  const response = await fetch('/__dot_preview__/state', { cache: 'no-store' });
  if (!response.ok) throw new Error(`ライブラリのプレビューを読み込めませんでした (${response.status})。`);
  const state: PreviewState = await response.json();
  const api = {
    takePostLink: async () => null,
    onPostLink: () => () => {},
    getConfig: async () => clone(state.config),
    getExtensionContact: async () => clone(state.extensionContact),
    listPosts: async () => clone(state.snapshot),
    listPostsDelta: async () => ({ ...clone(state.snapshot), full: true }),
    searchCandidates: async (query, entries) => {
      const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
      return entries
        .filter((entry) => {
          const text = [entry.title, entry.keywords, entry.screenName].join(' ').toLocaleLowerCase();
          return terms.every((term) => text.includes(term));
        })
        .map((entry) => entry.id);
    },
    searchFullText: async (query, limit = 50) => {
      const term = query.trim().toLocaleLowerCase();
      if (!term) return [];
      const hits: FullTextHit[] = [];
      for (const post of state.snapshot.posts) {
        const fields = {
          text: post.text,
          title: post.title,
          seriesTitle: post.seriesTitle,
          displayName: post.displayName,
          screenName: post.screenName,
          tag: post.tags.join(' '),
          hashtag: post.hashtags.join(' '),
          alt: post.media.map((media) => media.alt).join(' '),
          quoted: post.quotedPost?.text,
          linkCard: post.linkCard ? [post.linkCard.title, post.linkCard.description].join(' ') : null,
        };
        for (const [field, value] of Object.entries(fields)) {
          const matchStart = value?.toLocaleLowerCase().indexOf(term) ?? -1;
          if (matchStart < 0 || !value) continue;
          hits.push({ postId: post.captureId, rank: 1, field, snippetText: value, matchStart, matchEnd: matchStart + term.length });
          break;
        }
        if (hits.length >= limit) break;
      }
      return hits;
    },
    applyCachedMetadata: async () => {
      toast.info(readOnlyMessage);
      return { ok: false, updated: 0 };
    },
    recordPostView: async () => ({ ok: false }) as const,
    setMediaCrop: refuseWrite,
    setMediaEdit: refuseWrite,
    getTagGroups: async () => clone(state.tagGroups),
    setTagGroups: refuseWrite,
    getTagVocab: async () => clone(state.vocab),
    saveClassifiedTag: async () => {
      throw new Error(readOnlyMessage);
    },
    getClassifiedAssignments: async (ids) => clone(state.snapshot.posts.filter((post) => ids.includes(post.captureId)).map((post) => ({ postId: post.captureId, tagIds: post.tagIds }))),
    setClassifiedAssignments: async () => {
      throw new Error(readOnlyMessage);
    },
    renameTag: async () => {
      throw new Error(readOnlyMessage);
    },
    mergeTags: refuseWrite,
    setTagGroup: refuseWrite,
    deleteTags: async () => {
      toast.info(readOnlyMessage);
      return { ok: false, deletedIds: [] };
    },
    getUngrouped: async () => clone(state.ungrouped),
    setUngrouped: refuseWrite,
    getPosterTags: async () => clone(state.posterTags),
    setPosterTags: refuseWrite,
    getManualGroups: async () => clone(state.groups),
    setManualGroups: refuseWrite,
    getFolders: async () => clone(state.folders),
    setFolders: refuseWrite,
    getTabs: async () => clone(state.tabs),
    setTabs: async () => ({ ok: false }),
    appendHistory: async () => ({ ok: false }),
    queryHistory: async (options) => ({
      rows: clone(state.history.filter((row) => (!options.search || row.title.toLocaleLowerCase().includes(options.search.toLocaleLowerCase())) && (!options.before || row.ts < options.before.ts || (row.ts === options.before.ts && row.id < options.before.id))).sort((a, b) => b.ts - a.ts || b.id - a.id)),
      hasMore: false,
    }),
    deleteHistoryRow: refuseWrite,
    clearHistory: refuseWrite,
    openExternal: async () => {
      toast.info(unavailableMessage);
    },
    openImageWindow: async () => {
      toast.info(unavailableMessage);
      return false;
    },
    showInFolder: async () => {
      toast.info(unavailableMessage);
    },
    copyImage: async () => {
      toast.info(unavailableMessage);
      return false;
    },
    copyText: async () => {
      toast.info(unavailableMessage);
      return false;
    },
    getAppInfo: async () => clone(state.appInfo),
    getPrefs: async () => clone(state.prefs),
    setPref: async () => ({ ok: false }),
    imageDataUrl: async (file) => {
      const asset = await fetch(`/__dot_preview__/asset?file=${encodeURIComponent(file)}`);
      if (!asset.ok) return null;
      const blob = await asset.blob();
      return new Promise<string | null>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    },
    ugoiraFramesPresent: async () => false,
    ugoiraFrame: async () => null,
    deletePost: refuseWrite,
    updateTags: refuseWrite,
    clearAll: async () => {
      toast.info(readOnlyMessage);
      return { ok: false, count: 0, blocked: readOnlyMessage };
    },
    exportSave: async () => {
      toast.info(unavailableMessage);
      return { saved: false };
    },
    exportComplete: async () => {
      toast.info(unavailableMessage);
      return { saved: false };
    },
    importComplete: async () => {
      toast.info(readOnlyMessage);
      return { ok: false, canceled: true };
    },
    pickSaveFolder: async () => {
      toast.info(readOnlyMessage);
      return { ok: false, canceled: true };
    },
    moveSaveFolder: async () => {
      toast.info(readOnlyMessage);
      return { ok: false, error: readOnlyMessage };
    },
    getLibraryStatus: async () => clone(state.libraryStatus),
    pickRepointFolder: async () => {
      toast.info(readOnlyMessage);
      return { ok: false, canceled: true };
    },
    applyRepoint: async () => {
      toast.info(readOnlyMessage);
      return { ok: false, error: readOnlyMessage };
    },
    onSaveFolderProgress: () => {},
    onExportProgress: () => () => {},
    getExportReminder: async () => clone(state.reminder),
    setExportReminderEnabled: async () => {
      toast.info(readOnlyMessage);
      return clone(state.reminder);
    },
    setExportReminderThreshold: async () => {
      toast.info(readOnlyMessage);
      return clone(state.reminder);
    },
    onExportReminderChanged: () => {},
    importImages: async () => {
      toast.info(readOnlyMessage);
      return { imported: 0, skipped: 0, canceled: true };
    },
    collectDroppedPaths: async () => ({ files: [], mediaCount: 0, groups: [], error: readOnlyMessage }),
    importDroppedPaths: async () => ({ imported: 0, skipped: 0, error: readOnlyMessage }),
    getPathForFile: () => '',
    importClipboard: async () => ({ imported: 0, error: readOnlyMessage }),
    getIntegrityStatus: async () => clone(state.integrity),
    runOrphanRecovery: async () => {
      toast.info(readOnlyMessage);
      return { ok: false, error: readOnlyMessage };
    },
    onIntegrityCheckDone: () => {},
    listTrash: async () => state.trash.map((post) => PostRecordSchema.parse(clone(post))),
    restorePost: refuseWrite,
    emptyTrash: refuseWrite,
    deleteFromTrash: refuseWrite,
    onPostsChanged: () => {},
    windowControl: async () => false,
    setTitlebarSymbolDim: async () => {},
    openNewWindow: () => {
      toast.info(unavailableMessage);
    },
    onOrgChanged: () => () => {},
  } satisfies DotPreload;
  window.dot = api;
}
