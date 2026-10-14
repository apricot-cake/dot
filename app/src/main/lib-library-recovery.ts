import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { SCHEMA_VERSION } from './lib-db-schema.ts';

type RecoveryValidation = { ok: true } | { ok: false; error: string };

function overlaps(a: string, b: string): boolean {
  const relative = path.relative(a, b);
  return !relative || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

// 復帰候補の確認では、保存先の作成・書き込み確認・スキーマ移行を行わない。
export function validateRecoveryLibrary(dir: string, configDir: string): RecoveryValidation {
  if (typeof dir !== 'string' || !dir.trim()) return { ok: false, error: 'invalid' };
  let folder: string;
  try {
    if (!fs.statSync(dir).isDirectory()) return { ok: false, error: 'no-library' };
    folder = fs.realpathSync(dir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { ok: false, error: code === 'ENOENT' || code === 'ENOTDIR' ? 'no-library' : 'not-readable' };
  }
  let config = path.resolve(configDir);
  try {
    config = fs.realpathSync(config);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return { ok: false, error: 'not-readable' };
  }
  if (overlaps(folder, config) || overlaps(config, folder)) return { ok: false, error: 'config-overlap' };
  const file = path.join(folder, 'dot.db');
  try {
    if (!fs.statSync(file).isFile()) return { ok: false, error: 'no-library' };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { ok: false, error: code === 'ENOENT' || code === 'ENOTDIR' ? 'no-library' : 'not-readable' };
  }
  let db: Database.Database | undefined;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    if (db.pragma('quick_check', { simple: true }) !== 'ok') return { ok: false, error: 'invalid-library' };
    const tables = new Set((db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all() as { name: string }[]).map((row) => row.name));
    const required = {
      posts: ['captureId', 'image', 'url', 'capturedAt', 'updatedAt'],
      media: ['id', 'postId', 'file', 'seq'],
      tags: ['id', 'name'],
      post_tags: ['postId', 'tagId'],
      folders: ['id', 'name'],
      folder_items: ['folderId', 'postId'],
    };
    for (const [table, columns] of Object.entries(required)) {
      if (!tables.has(table)) return { ok: false, error: 'not-a-library' };
      const actual = new Set((db.pragma(`table_info(${table})`) as { name: string }[]).map((row) => row.name));
      if (columns.some((column) => !actual.has(column))) return { ok: false, error: 'not-a-library' };
    }
    const version = Number(db.pragma('user_version', { simple: true }));
    if (version < 49 || version > SCHEMA_VERSION) return { ok: false, error: 'incompatible-db' };
    return { ok: true };
  } catch (error) {
    const code = (error as { code?: string }).code;
    return { ok: false, error: code === 'SQLITE_CANTOPEN' || code === 'SQLITE_PERM' || code === 'SQLITE_AUTH' ? 'not-readable' : 'invalid-library' };
  } finally {
    db?.close();
  }
}
