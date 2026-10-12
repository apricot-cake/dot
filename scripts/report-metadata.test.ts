import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { expect, test, vi } from 'vitest';

test('通常・DB由来・unsupported の投稿者を実際の出力処理で安全にする', () => {
  const entries = [
    { key: 'direct', status: 'failed', author: '=1+1', ids: ['a'] },
    { key: 'db', status: 'failed', ids: ['b'] },
    { key: 'ordinary', status: 'failed', author: '山田,"太郎"\n続き', ids: ['c'] },
  ];
  const state = { entries, unsupported: [{ displayName: ' ＝1+1', captureId: '+1', url: '@SUM(1)' }] };
  const writes = new Map<string, string>();
  const close = vi.fn();
  class DatabaseSync {
    prepare(sql: string) {
      return { get: (id: string) => (sql.includes('FROM posts') ? { captureId: id, displayName: '\t+1' } : undefined) };
    }
    close = close;
  }
  const requireFixture = (name: string) => {
    if (name === 'node:fs') return { readFileSync: (file: string) => JSON.stringify(file.endsWith('config.json') ? { saveFolder: 'fixture' } : state), writeFileSync: (file: string, text: string) => writes.set(file, text) };
    if (name === 'node:path') return path;
    if (name === 'node:crypto') return crypto;
    if (name === 'node:sqlite') return { DatabaseSync };
    if (name === '../native-host/paths.mts') return { configDir: () => 'config' };
    if (name === './lib-report-csv.cts') return require('./lib-report-csv.cts');
    throw new Error(name);
  };
  vm.runInNewContext(stripTypeScriptTypes(fs.readFileSync(path.join(__dirname, 'report-metadata.cts'), 'utf8')), { require: requireFixture, console: { log: vi.fn() } });
  const csv = writes.get(path.join('fixture', '.dot-metadata-backfill', '要確認.csv'));
  expect(csv).toContain('"\t=1+1"');
  expect(csv).toContain('"\t\t+1"');
  expect(csv).toContain('"\t ＝1+1"');
  expect(csv).toContain('"\t@SUM(1)"');
  expect(csv).toContain('"山田,""太郎""\n続き"');
  expect(close).toHaveBeenCalledOnce();
});
