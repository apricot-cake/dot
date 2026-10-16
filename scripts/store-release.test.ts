import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { verifyRelease, writeRelease } from './release-artifacts.mjs';
import { chromePublishBody, microsoftPackageUpdate, runStoreOperation } from './store-release.mjs';

const temporary: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const folder of temporary.splice(0)) await fs.rm(folder, { recursive: true, force: true });
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dot-release-test-'));
  temporary.push(root);
  const app = path.join(root, 'dot.msix');
  const extension = path.join(root, 'dot.zip');
  await fs.writeFile(app, 'verified app');
  await fs.writeFile(extension, 'verified extension');
  const folder = path.join(root, 'release');
  const commit = 'a'.repeat(40);
  await writeRelease({ folder, app, extension, commit, channel: 'store' });
  return { folder, commit };
}

test('提出前に対象コミットと全成果物のハッシュを確認する', async () => {
  const { folder, commit } = await fixture();
  await expect(verifyRelease(folder, commit)).resolves.toMatchObject({ commit });
  await expect(verifyRelease(folder, 'b'.repeat(40))).rejects.toThrow('コミット');
  await fs.writeFile(path.join(folder, 'dot.zip'), 'changed');
  await expect(verifyRelease(folder, commit)).rejects.toThrow('ハッシュ');
});

test('検証identityの成果物を本番提出しない', async () => {
  const { folder, commit } = await fixture();
  const file = path.join(folder, 'release.json');
  const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
  manifest.channel = 'verification';
  await fs.writeFile(file, JSON.stringify(manifest));
  await expect(verifyRelease(folder, commit)).rejects.toThrow('検証用');
});

test('下書きの掲載情報を保ち、公開待ちを必須にする', () => {
  const listing = { 'ja-jp': { description: '掲載文' } };
  const source = { targetPublishMode: 'Manual', visibility: 'Public', listings: listing, applicationPackages: [{ fileName: 'old.msix', fileStatus: 'Uploaded' }] };
  const result = microsoftPackageUpdate(source, 'dot.msix');
  expect(result.listings).toBe(listing);
  expect(result.targetPublishMode).toBe('Manual');
  expect(result.applicationPackages).toEqual([
    { fileName: 'old.msix', fileStatus: 'PendingDelete' },
    { fileName: 'dot.msix', fileStatus: 'PendingUpload', minimumDirectXVersion: 'None', minimumSystemRam: 'None' },
  ]);
  expect(source.applicationPackages[0].fileStatus).toBe('Uploaded');
  expect(() => microsoftPackageUpdate({ ...source, targetPublishMode: 'Immediate' }, 'dot.msix')).toThrow('公開待ち');
  expect(chromePublishBody('submit')).toEqual({ publishType: 'STAGED_PUBLISH' });
});

test('保留中はAPIを呼ぶ前に変更操作を拒否する', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  await expect(runStoreOperation({ store: 'chrome', operation: 'submit', env: { STORE_ACCESS_TOKEN: 'test' } })).rejects.toThrow('保留中');
  expect(fetch).not.toHaveBeenCalled();
});

test('状態確認はGETだけを使う', async () => {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (_url: unknown, options: RequestInit) => {
    calls.push(options.method || 'GET');
    return new Response(JSON.stringify({ lastAsyncUploadState: 'SUCCEEDED' }), { status: 200 });
  });
  await expect(runStoreOperation({ store: 'chrome', operation: 'status', env: { STORE_ACCESS_TOKEN: 'test', CHROME_EXTENSION_ID: 'a'.repeat(32), CHROME_PUBLISHER_ID: 'publisher' } })).resolves.toMatchObject({ lastAsyncUploadState: 'SUCCEEDED' });
  expect(calls).toEqual(['GET']);
});

test('Microsoftのアップロードは既存下書きの掲載情報を保ち、審査提出しない', async () => {
  const { folder, commit } = await fixture();
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  vi.stubGlobal('fetch', async (url: string | URL, options: RequestInit) => {
    calls.push({ url: String(url), method: options.method || 'GET', body: options.body });
    if (String(url).endsWith('/applications/product')) return new Response(JSON.stringify({ pendingApplicationSubmission: { id: '123' } }));
    if (String(url).endsWith('/submissions/123') && !options.method)
      return new Response(JSON.stringify({ id: '123', status: 'PendingCommit', targetPublishMode: 'Manual', visibility: 'Public', listings: { ja: { text: '既存の掲載情報' } }, fileUploadUrl: 'https://test.blob.core.windows.net/upload?sig=test', applicationPackages: [] }));
    if (options.method === 'PUT' && String(url).includes('.blob.core.windows.net')) return new Response('', { status: 201 });
    return new Response(JSON.stringify({ fileUploadUrl: 'https://new.blob.core.windows.net/upload?sig=new' }));
  });
  const result = await runStoreOperation({
    store: 'microsoft',
    operation: 'upload',
    env: { STORE_ACCESS_TOKEN: 'test', STORE_SUBMISSIONS_ENABLED: 'true', STORE_ARTIFACT_DIR: folder, STORE_APPROVED_COMMIT: commit, GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'workflow_dispatch', MICROSOFT_PRODUCT_ID: 'product', MICROSOFT_SUBMISSION_ID: '123' },
  });
  expect(result).toMatchObject({ uploadAccepted: true, committed: false });
  expect(calls.map((item) => item.method)).toEqual(['GET', 'GET', 'PUT', 'PUT']);
  expect(JSON.parse(calls[2].body as string).listings).toEqual({ ja: { text: '既存の掲載情報' } });
  expect(calls[3].url).toBe('https://new.blob.core.windows.net/upload?sig=new');
  expect(calls.some((item) => item.url.endsWith('/commit'))).toBe(false);
});

test('同じパッケージを再アップロードしても削除予定と追加予定を重複させない', () => {
  const source = { targetPublishMode: 'Manual', visibility: 'Public', applicationPackages: [] };
  const first = microsoftPackageUpdate(source, 'dot.msix');
  expect(microsoftPackageUpdate(first, 'dot.msix').applicationPackages).toEqual(first.applicationPackages);
});

test('Chromeの非同期アップロード完了を確認してから公開待ちで審査提出する', async () => {
  const { folder, commit } = await fixture();
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string, options: RequestInit) => {
    calls.push(url);
    if (url.endsWith(':upload')) return new Response(JSON.stringify({ uploadState: 'IN_PROGRESS' }));
    if (url.endsWith(':publish')) {
      expect(JSON.parse(options.body as string)).toEqual({ publishType: 'STAGED_PUBLISH' });
      return new Response(JSON.stringify({ state: 'PENDING_REVIEW' }));
    }
    return new Response(JSON.stringify({ lastAsyncUploadState: 'SUCCEEDED' }));
  });
  const result = await runStoreOperation({
    store: 'chrome',
    operation: 'submit',
    env: { STORE_ACCESS_TOKEN: 'test', STORE_SUBMISSIONS_ENABLED: 'true', STORE_ARTIFACT_DIR: folder, STORE_APPROVED_COMMIT: commit, GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'workflow_dispatch', CHROME_PUBLISHER_ID: 'publisher', CHROME_EXTENSION_ID: 'a'.repeat(32) },
  });
  expect(result.state).toBe('PENDING_REVIEW');
  expect(calls.map((url) => url.split(':').at(-1))).toEqual(['fetchStatus', 'upload', 'fetchStatus', 'publish']);
});
