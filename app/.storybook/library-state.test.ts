import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_SQL } from '../src/main/lib-db-schema.ts';
import { normalizePostRecord } from '../../native-host/post-record.mts';
import { readPreviewState } from './library-state.ts';

const Sqlite: typeof Database = createRequire(new URL('../../package.json', import.meta.url))('better-sqlite3');
const temporary: string[] = [];
afterEach(() => {
  for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function manifest(directory: string): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const name of fs.readdirSync(directory, { recursive: true }) as string[]) {
    const file = path.join(directory, name);
    if (fs.statSync(file).isFile()) entries[name] = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  }
  return entries;
}

describe('読み取り専用の実ライブラリプレビュー', () => {
  it('投稿、整理情報、旧形式タブ、ゴミ箱を元ファイルの変更やコピーなしで読む', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dot-preview-state-'));
    temporary.push(directory);
    const library = path.join(directory, 'Library');
    fs.mkdirSync(path.join(library, '.trash'), { recursive: true });
    const config = { saveFolder: library, theme: 'dark', extensionId: 'test-extension', exportReminder: { enabled: true, threshold: 25, changesSinceExport: 30 }, integrity: { dbOk: true, orphanCount: 2 } };
    // Windows で編集された UTF-8 BOM 付き設定も、デスクトップと同じように読む。
    fs.writeFileSync(path.join(directory, 'config.json'), '\uFEFF' + JSON.stringify(config));
    fs.writeFileSync(path.join(directory, 'extension-contact.json'), 'contact');
    fs.writeFileSync(path.join(library, 'original.jpg'), 'original-image');
    fs.writeFileSync(path.join(library, '.trash', 'trashed.jpg'), 'trashed-image');
    fs.writeFileSync(path.join(library, '.trash', 'trashed.json'), JSON.stringify(normalizePostRecord({ captureId: 'trashed', capturedAt: '2026-01-01', updatedAt: '2026-01-01', trashedAt: '2026-01-02', image: 'trashed.jpg' })));
    const database = new Sqlite(path.join(library, 'dot.db'));
    database.exec(CURRENT_SCHEMA_SQL);
    database.prepare('INSERT INTO posts (captureId, text, image, capturedAt, updatedAt) VALUES (?, ?, ?, ?, ?)').run('post-real', '実際の投稿', 'original.jpg', '2026-01-01', '2026-01-01');
    database.prepare('INSERT INTO folders (id, name, kind) VALUES (?, ?, ?)').run('folder-real', '実際のフォルダ', 'static');
    database.prepare('INSERT INTO folder_items (folderId, postId) VALUES (?, ?)').run('folder-real', 'post-real');
    database.prepare('INSERT INTO tabs (id, windowId, position, pinned, title, state) VALUES (?, ?, ?, ?, ?, ?)').run('tab-real', 'main', 0, 0, '保存されたタブ', JSON.stringify({ scrollTop: 12 }));
    database.prepare('INSERT INTO tab_windows (windowId, activeTabId) VALUES (?, ?)').run('main', 'tab-real');
    database.prepare('INSERT INTO history (ts, u, kind, title, state) VALUES (?, ?, ?, ?, ?)').run(123, 'dot://posts', 'posts', '実際の履歴', 'null');
    database.close();
    const before = manifest(directory);
    const { state, libraryRoot, files } = await readPreviewState(directory);
    expect(libraryRoot).toBe(library);
    expect(state.snapshot.posts).toHaveLength(1);
    expect(state.snapshot.posts[0]).toMatchObject({ captureId: 'post-real', text: '実際の投稿' });
    expect(state.folders.folders[0]).toMatchObject({ id: 'folder-real', items: ['post-real'] });
    expect(state.tabs?.tabs[0].state).toMatchObject({ view: null, scrollTop: 12 });
    expect(state.history[0].title).toBe('実際の履歴');
    expect(state.trash[0]).toMatchObject({ captureId: 'trashed', image: '.trash/trashed.jpg' });
    expect(state.prefs.theme).toBe('dark');
    expect(state.reminder).toMatchObject({ changesSinceExport: 30, due: true });
    expect(state.integrity).toMatchObject({ dbOk: true, orphanCount: 2 });
    expect(state.extensionContact.contacted).toBe(true);
    expect(files).toEqual(new Set(['original.jpg', '.trash/trashed.jpg']));
    expect(files.has('dot.db')).toBe(false);
    expect(manifest(directory)).toEqual(before);
  });

  it('DB がなければ作成せず失敗する', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dot-preview-state-'));
    temporary.push(directory);
    const library = path.join(directory, 'Library');
    fs.mkdirSync(library);
    fs.writeFileSync(path.join(directory, 'config.json'), JSON.stringify({ saveFolder: library }));
    const before = manifest(directory);
    await expect(readPreviewState(directory)).rejects.toThrow();
    expect(manifest(directory)).toEqual(before);
  });
});
