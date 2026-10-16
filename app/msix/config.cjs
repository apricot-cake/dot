'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const MIN_WINDOWS_VERSION = '10.0.22000.0';
const UNSIGNED_PACKAGE_OID = 'OID.2.25.311729368913984317654407730594956997722=1';

function xml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
}

function packageIdentity(env = process.env) {
  const channel = env.DOT_MSIX_CHANNEL || 'verification';
  if (!['verification', 'store'].includes(channel)) throw new Error('DOT_MSIX_CHANNEL は verification または store を指定してください。');
  if (channel === 'verification') return { channel, name: 'dot.Verification', publisher: `CN=dot Verification, ${UNSIGNED_PACKAGE_OID}`, publisherDisplayName: 'dot Verification', displayName: 'dot Verification' };
  const fields = ['DOT_MSIX_IDENTITY_NAME', 'DOT_MSIX_PUBLISHER', 'DOT_MSIX_PUBLISHER_DISPLAY_NAME'];
  for (const field of fields) if (!env[field]?.trim()) throw new Error(`Store パッケージの作成には ${field} が必要です。Partner Center の正式な値を指定してください。`);
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]{2,49}$/.test(env.DOT_MSIX_IDENTITY_NAME)) throw new Error('Store の Package Identity Name が無効です。');
  if (!env.DOT_MSIX_PUBLISHER.startsWith('CN=')) throw new Error('Store の Publisher は Partner Center の CN= で始まる完全な値を指定してください。');
  if (env.DOT_MSIX_IDENTITY_NAME === 'dot.Verification' || env.DOT_MSIX_PUBLISHER === 'CN=dot Verification') throw new Error('検証用の identity は Store 提出に使用できません。');
  if (env.DOT_MSIX_PUBLISHER.includes(UNSIGNED_PACKAGE_OID)) throw new Error('unsigned 検証用の OID は Store の Publisher に使用できません。');
  return { channel, name: env.DOT_MSIX_IDENTITY_NAME, publisher: env.DOT_MSIX_PUBLISHER, publisherDisplayName: env.DOT_MSIX_PUBLISHER_DISPLAY_NAME, displayName: 'dot' };
}

function verificationRevision(channel, env = process.env) {
  const value = env.DOT_MSIX_VERIFICATION_REVISION ?? '0';
  if (!/^\d+$/.test(value) || Number(value) > 65535) throw new Error('DOT_MSIX_VERIFICATION_REVISION は 0..65535 の整数を指定してください。');
  const revision = Number(value);
  if (channel === 'store' && revision !== 0) throw new Error('Store パッケージの revision は常に 0 です。');
  return revision;
}

function msixVersion(version, revision = 0) {
  if (!Number.isInteger(revision) || revision < 0 || revision > 65535) throw new Error('MSIX の revision は 0..65535 の整数である必要があります。');
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('MSIX の作成には安定版の major.minor.patch が必要です。');
  const parts = version.split('.').map(Number);
  if (parts[0] === 0 || parts.some((part) => part > 65535)) throw new Error('MSIX のバージョンは major が 1 以上、各桁が 65535 以下である必要があります。');
  return `${parts.join('.')}.${revision}`;
}

function renderManifest(template, identity, version, revision = 0) {
  if (identity.channel === 'store' && revision !== 0) throw new Error('Store パッケージの revision は常に 0 です。');
  const values = { IdentityName: identity.name, Publisher: identity.publisher, PublisherDisplayName: identity.publisherDisplayName, DisplayName: identity.displayName, Version: msixVersion(version, revision), MinVersion: MIN_WINDOWS_VERSION };
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in values)) throw new Error(`未知の MSIX manifest 変数: ${key}`);
    return xml(values[key]);
  });
}

function msixOutputFileName(version, channel) {
  // バージョンと channel を検証し、削除対象を生成先の単一ファイルに限定する。
  msixVersion(version);
  if (!['verification', 'store'].includes(channel)) throw new Error('MSIX の channel が不正です。');
  return `dot-${channel}-${version}-x64`;
}

async function cleanMsixOutput(outDir, version, env = process.env) {
  const identity = packageIdentity(env);
  verificationRevision(identity.channel, env);
  const output = path.join(outDir, 'make', 'msix', 'x64', `${msixOutputFileName(version, identity.channel)}.msix`);
  // Forge MSIX Maker は既存の出力先を上書きしないため、今回生成するファイルだけを整理する。
  await fs.rm(output, { force: true });
}

async function prepareMsix(arch, env = process.env) {
  if (arch !== 'x64') throw new Error('dot の MSIX は x64 のみを対象にしています。');
  const identity = packageIdentity(env);
  const revision = verificationRevision(identity.channel, env);
  const appDir = path.resolve(__dirname, '..');
  const { version } = require('../package.json');
  const directory = path.join(appDir, 'artifacts', 'msix-input', identity.channel);
  const assets = path.join(directory, 'assets');
  await fs.mkdir(assets, { recursive: true });
  const template = await fs.readFile(path.join(__dirname, 'AppxManifest.xml.in'), 'utf8');
  const appManifest = path.join(directory, 'AppxManifest.xml');
  await fs.writeFile(appManifest, renderManifest(template, identity, version, revision));
  // 元のアプリアイコンから、MSIX が要求する画像サイズだけを生成する。
  const sharp = require('sharp');
  for (const [name, size] of [
    ['StoreLogo.png', 50],
    ['Square44x44Logo.png', 44],
    ['Square150x150Logo.png', 150],
  ]) {
    await sharp(path.join(appDir, 'assets', 'icon.png'))
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(path.join(assets, name));
  }
  return { appManifest, packageAssets: assets, sign: false, windowsKitVersion: env.DOT_MSIX_WINDOWS_KIT_VERSION || '10.0.26100.0', outputFileName: msixOutputFileName(version, identity.channel) };
}

module.exports = { MIN_WINDOWS_VERSION, packageIdentity, verificationRevision, msixVersion, renderManifest, cleanMsixOutput, prepareMsix };
