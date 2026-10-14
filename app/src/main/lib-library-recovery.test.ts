import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { CURRENT_SCHEMA_SQL, SCHEMA_VERSION } from './lib-db-schema.ts';
import { validateRecoveryLibrary } from './lib-library-recovery.ts';

const roots: string[] = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dot-recovery-'));
  roots.push(root);
  const library = path.join(root, 'library');
  const config = path.join(root, 'config');
  fs.mkdirSync(library);
  fs.mkdirSync(config);
  return { root, library, config };
}
function createLibrary(dir: string, version = SCHEMA_VERSION) {
  let schema = CURRENT_SCHEMA_SQL;
  if (version <= 53) schema = schema.replace('  saveIncomplete INTEGER NOT NULL DEFAULT 0 CHECK(saveIncomplete IN (0, 1)),\n', '');
  if (version <= 52) schema = schema.replace('  lastViewedAt TEXT,\n', '');
  if (version <= 51) schema = schema.replace(/CREATE TABLE poster_names \([\s\S]*?\);/, '');
  if (version <= 50) schema = schema.replace('  rotation INTEGER NOT NULL DEFAULT 0,\n  flipped INTEGER NOT NULL DEFAULT 0', '  fixture INTEGER');
  if (version === 49)
    schema = schema
      .replace("  category TEXT NOT NULL DEFAULT 'general' CHECK(category IN ('general','work','character')),\n  workId INTEGER REFERENCES tags(id) ON DELETE SET NULL", '  fixture INTEGER')
      .replace('CREATE INDEX idx_tags_workId ON tags(workId);', '')
      .replace('  implied INTEGER NOT NULL DEFAULT 0 CHECK(implied IN (0,1)),\n', '');
  const db = new Database(path.join(dir, 'dot.db'));
  db.exec(schema);
  db.pragma(`user_version = ${version}`);
  db.close();
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('validateRecoveryLibrary', () => {
  test.each([49, 50, 51, 52, 53, SCHEMA_VERSION])('対応する既存DB v%i を書き換えずに受け入れる', (version) => {
    const { library, config } = fixture();
    createLibrary(library, version);
    const file = path.join(library, 'dot.db');
    const before = fs.readFileSync(file);
    expect(validateRecoveryLibrary(library, config)).toEqual({ ok: true });
    expect(fs.readFileSync(file)).toEqual(before);
    expect(fs.readdirSync(library)).toEqual(['dot.db']);
  });
  test('移動・改名後も同じ場所の再選択も受け入れる', () => {
    const { root, library, config } = fixture();
    createLibrary(library);
    const renamed = path.join(root, 'renamed');
    fs.renameSync(library, renamed);
    expect(validateRecoveryLibrary(renamed, config)).toEqual({ ok: true });
    expect(validateRecoveryLibrary(renamed, config)).toEqual({ ok: true });
  });
  test('存在しないフォルダを作成しない', () => {
    const { root, config } = fixture();
    const missing = path.join(root, 'missing');
    expect(validateRecoveryLibrary(missing, config)).toEqual({ ok: false, error: 'no-library' });
    expect(fs.existsSync(missing)).toBe(false);
  });
  test('空フォルダや画像だけのフォルダにDBを作成しない', () => {
    const { library, config } = fixture();
    expect(validateRecoveryLibrary(library, config)).toEqual({ ok: false, error: 'no-library' });
    fs.writeFileSync(path.join(library, 'photo.png'), 'fixture');
    expect(validateRecoveryLibrary(library, config)).toEqual({ ok: false, error: 'no-library' });
    expect(fs.readdirSync(library)).toEqual(['photo.png']);
  });
  test.each(['empty', 'unrelated', 'columns'])('無関係なDBを拒否する: %s', (kind) => {
    const { library, config } = fixture();
    if (kind === 'columns') {
      createLibrary(library);
      const db = new Database(path.join(library, 'dot.db'));
      db.exec('ALTER TABLE posts RENAME COLUMN captureId TO unrelated');
      db.close();
    } else {
      const db = new Database(path.join(library, 'dot.db'));
      if (kind === 'unrelated') db.exec('CREATE TABLE notes(value TEXT)');
      db.close();
    }
    expect(validateRecoveryLibrary(library, config)).toEqual({ ok: false, error: 'not-a-library' });
  });
  test.each([48, SCHEMA_VERSION + 1])('非対応バージョン%iを拒否する', (version) => {
    const { library, config } = fixture();
    createLibrary(library);
    const db = new Database(path.join(library, 'dot.db'));
    db.pragma(`user_version = ${version}`);
    db.close();
    expect(validateRecoveryLibrary(library, config)).toEqual({ ok: false, error: 'incompatible-db' });
  });
  test('破損ファイルを消さずに拒否する', () => {
    const { library, config } = fixture();
    const file = path.join(library, 'dot.db');
    fs.writeFileSync(file, 'not a sqlite database');
    expect(validateRecoveryLibrary(library, config)).toEqual({ ok: false, error: 'invalid-library' });
    expect(fs.readFileSync(file, 'utf8')).toBe('not a sqlite database');
  });
  test('DB名のディレクトリを拒否する', () => {
    const { library, config } = fixture();
    fs.mkdirSync(path.join(library, 'dot.db'));
    expect(validateRecoveryLibrary(library, config)).toEqual({ ok: false, error: 'no-library' });
  });
  test('設定フォルダの親子関係と別名を拒否する', () => {
    const { root, library, config } = fixture();
    createLibrary(library);
    expect(validateRecoveryLibrary(library, path.join(library, 'config'))).toEqual({ ok: false, error: 'config-overlap' });
    expect(validateRecoveryLibrary(library, root)).toEqual({ ok: false, error: 'config-overlap' });
    const alias = path.join(root, 'config-alias');
    fs.symlinkSync(config, alias, process.platform === 'win32' ? 'junction' : 'dir');
    expect(validateRecoveryLibrary(alias, config)).toEqual({ ok: false, error: 'config-overlap' });
  });
  test('フォルダを読めない場合は作成や修復を試みない', () => {
    const { library, config } = fixture();
    vi.spyOn(fs, 'statSync').mockImplementation(() => {
      throw Object.assign(new Error('access denied'), { code: 'EACCES' });
    });
    expect(validateRecoveryLibrary(library, config)).toEqual({ ok: false, error: 'not-readable' });
  });
  test('開いているWALの投稿を読み取り、既存のDBとWALを変更しない', () => {
    const { library, config } = fixture();
    createLibrary(library);
    const file = path.join(library, 'dot.db');
    const db = new Database(file);
    try {
      db.pragma('journal_mode = WAL');
      db.exec("INSERT INTO posts(captureId,capturedAt,updatedAt) VALUES ('wal-post','now','now')");
      const beforeDb = fs.readFileSync(file);
      const beforeWal = fs.readFileSync(`${file}-wal`);
      expect(validateRecoveryLibrary(library, config)).toEqual({ ok: true });
      expect(fs.readFileSync(file)).toEqual(beforeDb);
      expect(fs.readFileSync(`${file}-wal`)).toEqual(beforeWal);
    } finally {
      db.close();
    }
  });
});
