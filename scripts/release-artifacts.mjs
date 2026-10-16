import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function verifyRelease(folder, expectedCommit) {
  const manifest = JSON.parse(await fs.readFile(path.join(folder, 'release.json'), 'utf8'));
  if (!/^[a-f0-9]{40}$/.test(expectedCommit || '') || manifest.commit !== expectedCommit) throw new Error('対象コミットと成果物のコミットが一致しません');
  if (manifest.channel !== 'store') throw new Error('検証用パッケージはストアへ提出できません');
  for (const kind of ['app', 'extension']) {
    const file = manifest[kind];
    if (!file || path.basename(file.file) !== file.file || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('成果物の記録が不正です');
    const bytes = await fs.readFile(path.join(folder, file.file));
    if (sha256(bytes) !== file.sha256) throw new Error(`${kind} のハッシュが一致しません`);
  }
  return manifest;
}

export async function writeRelease({ folder, commit, app, extension, channel }) {
  if (!['verification', 'store'].includes(channel) || !/^[a-f0-9]{40}$/.test(commit)) throw new Error('チャンネルまたはコミットが不正です');
  await fs.mkdir(folder, { recursive: true });
  const manifest = { schema: 1, commit, channel };
  for (const [kind, source] of Object.entries({ app, extension })) {
    const bytes = await fs.readFile(source);
    const name = path.basename(source);
    await fs.writeFile(path.join(folder, name), bytes);
    manifest[kind] = { file: name, sha256: sha256(bytes) };
  }
  manifest.versions = {
    app: JSON.parse(await fs.readFile('app/package.json', 'utf8')).version,
    extension: JSON.parse(await fs.readFile('extension/package.json', 'utf8')).version,
  };
  await fs.writeFile(path.join(folder, 'release.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [folder, app, extension] = process.argv.slice(2);
  await writeRelease({ folder, app, extension, commit: process.env.GITHUB_SHA, channel: process.env.DOT_MSIX_CHANNEL });
}
