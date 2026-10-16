import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { verifyRelease } from './release-artifacts.mjs';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const { ZipFile } = require('yazl');

export function chromePublishBody(operation) {
  if (operation === 'submit') return { publishType: 'STAGED_PUBLISH' };
  if (operation === 'publish') return { publishType: 'DEFAULT_PUBLISH' };
  throw new Error('未対応の公開操作です');
}

export function microsoftPackageUpdate(submission, packageName) {
  if (submission.targetPublishMode !== 'Manual' || submission.visibility !== 'Public') throw new Error('Partner Centerで公開待ちとPublic audienceを設定してください');
  return {
    ...submission,
    targetPublishMode: 'Manual',
    applicationPackages: [...(submission.applicationPackages || []).filter((item) => item.fileName !== packageName).map((item) => ({ ...item, fileStatus: 'PendingDelete' })), { fileName: packageName, fileStatus: 'PendingUpload', minimumDirectXVersion: 'None', minimumSystemRam: 'None' }],
  };
}

async function request(url, token, options = {}) {
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(120000), headers: { Authorization: `Bearer ${token}`, ...(options.body && !(options.body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  if (!response.ok) throw new Error(`ストアAPIが失敗しました (${response.status})。再実行前に状態を確認してください`);
  if (response.status === 204) return {};
  return response.json();
}

async function zipPackage(file) {
  const zip = new ZipFile();
  zip.addFile(file, path.basename(file));
  const chunks = [];
  const result = new Promise((resolve, reject) => {
    zip.outputStream.on('data', (chunk) => chunks.push(chunk));
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    zip.outputStream.on('error', reject);
  });
  zip.end();
  return result;
}

export async function runStoreOperation({ store, operation, env = process.env }) {
  if (!['chrome', 'microsoft'].includes(store) || !['status', 'upload', 'submit', 'publish'].includes(operation)) throw new Error('操作が不正です');
  const token = env.STORE_ACCESS_TOKEN;
  if (!token) throw new Error('OIDCのアクセストークンがありません');
  let manifest;
  if (operation !== 'status') {
    if (env.STORE_SUBMISSIONS_ENABLED !== 'true') throw new Error('ストア変更操作は保留中です');
    manifest = await verifyRelease(env.STORE_ARTIFACT_DIR || 'store-artifacts', env.STORE_APPROVED_COMMIT);
    if (env.GITHUB_REF !== 'refs/heads/main' || env.GITHUB_EVENT_NAME !== 'workflow_dispatch') throw new Error('変更操作はmainの手動実行に限ります');
  }
  if (store === 'chrome') {
    if (!/^[a-p]{32}$/.test(env.CHROME_EXTENSION_ID || '') || !/^[A-Za-z0-9_-]+$/.test(env.CHROME_PUBLISHER_ID || '')) throw new Error('Chromeの登録情報がありません');
    const name = `publishers/${env.CHROME_PUBLISHER_ID}/items/${env.CHROME_EXTENSION_ID}`;
    const base = `https://chromewebstore.googleapis.com/v2/${name}`;
    const status = await request(`${base}:fetchStatus`, token);
    if (operation === 'status') return status;
    if (operation !== 'publish' && ['PENDING_REVIEW', 'STAGED'].includes(status.submittedItemRevisionStatus?.state)) throw new Error('審査中または公開待ちのため、変更前に状態を確認してください');
    if (operation === 'upload' || operation === 'submit') {
      const body = await fs.readFile(path.join(env.STORE_ARTIFACT_DIR || 'store-artifacts', manifest.extension.file));
      const uploaded = await request(`https://chromewebstore.googleapis.com/upload/v2/${name}:upload`, token, { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body });
      if (uploaded.uploadState === 'FAILED') throw new Error('アップロードの検証が失敗しました');
      if (operation === 'upload') return uploaded;
      if (uploaded.uploadState === 'IN_PROGRESS') {
        let ready = false;
        for (let attempt = 0; attempt < 30; attempt++) {
          await delay(2000);
          const processing = await request(`${base}:fetchStatus`, token);
          if (processing.lastAsyncUploadState === 'FAILED') throw new Error('アップロードの検証が失敗しました');
          if (processing.lastAsyncUploadState === 'SUCCEEDED') {
            ready = true;
            break;
          }
        }
        if (!ready) throw new Error('アップロードの完了を確認できません。状態を確認してください');
      } else if (uploaded.uploadState !== 'SUCCEEDED') throw new Error('アップロードが失敗しました');
    }
    if (operation === 'publish' && !status.submittedItemRevisionStatus?.distributionChannels?.some((channel) => channel.crxVersion === manifest.versions.extension)) throw new Error('公開待ちのバージョンが対象成果物と一致しません');
    if (operation === 'publish' && status.submittedItemRevisionStatus?.state !== 'STAGED') throw new Error('審査承認後の公開待ちを確認できません');
    return request(`${base}:publish`, token, { method: 'POST', body: JSON.stringify(chromePublishBody(operation)) });
  }
  if (!/^[A-Za-z0-9]+$/.test(env.MICROSOFT_PRODUCT_ID || '')) throw new Error('Microsoft Storeの製品IDがありません');
  const base = `https://manage.devcenter.microsoft.com/v1.0/my/applications/${env.MICROSOFT_PRODUCT_ID}`;
  const app = await request(base, token);
  const id = env.MICROSOFT_SUBMISSION_ID || app.pendingApplicationSubmission?.id || app.lastPublishedApplicationSubmission?.id;
  if (!/^[0-9]+$/.test(id || '')) throw new Error('Partner Centerで初回の掲載情報・年齢区分を設定してください');
  const submissionUrl = `${base}/submissions/${id}`;
  if (operation === 'status') return request(`${submissionUrl}/status`, token);
  if (operation === 'publish') throw new Error('Microsoft Storeの公開はPartner Centerで公開待ちの内容を確認して行ってください');
  if (id !== app.pendingApplicationSubmission?.id || id !== env.MICROSOFT_SUBMISSION_ID) throw new Error('既存の下書きを確認し、その提出IDを指定してください。下書きは自動作成・削除しません');
  const submission = await request(submissionUrl, token);
  if (submission.status !== 'PendingCommit') throw new Error('提出済み、処理中、または変更できない下書きです。状態を確認してください');
  const updated = microsoftPackageUpdate(submission, manifest.app.file);
  const updateResult = await request(submissionUrl, token, { method: 'PUT', body: JSON.stringify(updated) });
  const uploadUrl = new URL(updateResult.fileUploadUrl);
  if (uploadUrl.protocol !== 'https:' || !uploadUrl.hostname.endsWith('.blob.core.windows.net')) throw new Error('アップロード先が不正です');
  const bytes = await zipPackage(path.join(env.STORE_ARTIFACT_DIR || 'store-artifacts', manifest.app.file));
  const response = await fetch(uploadUrl, { method: 'PUT', redirect: 'error', headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': 'application/zip' }, body: bytes, signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`パッケージ送信が失敗しました (${response.status})。下書きの状態を確認してください`);
  if (operation === 'submit') return request(submissionUrl + '/commit', token, { method: 'POST' });
  return { submissionId: id, uploadAccepted: true, committed: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [store, operation = 'status'] = process.argv.slice(2);
  console.log(JSON.stringify(await runStoreOperation({ store, operation }), null, 2));
}
