import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, test } from 'vitest';

const { packageIdentity, verificationRevision, msixVersion, renderManifest, cleanMsixOutput } = require('../../app/msix/config.cjs');
const template = fs.readFileSync(path.resolve(import.meta.dirname, '../../app/msix/AppxManifest.xml.in'), 'utf8');

describe('MSIX identity と manifest', () => {
  test('再生成時は今回と同じ版・channel の MSIX だけを整理する', async () => {
    const outDir = fs.mkdtempSync(path.join(tmpdir(), 'dot-msix-output-'));
    const directory = path.join(outDir, 'make', 'msix', 'x64');
    fs.mkdirSync(directory, { recursive: true });
    const current = path.join(directory, 'dot-verification-1.1.0-x64.msix');
    const retained = ['dot-verification-1.0.0-x64.msix', 'dot-store-1.1.0-x64.msix', 'other.msix'];
    try {
      fs.writeFileSync(current, 'old package');
      for (const filename of retained) fs.writeFileSync(path.join(directory, filename), filename);
      await cleanMsixOutput(outDir, '1.1.0', {});
      expect(fs.existsSync(current)).toBe(false);
      for (const filename of retained) expect(fs.readFileSync(path.join(directory, filename), 'utf8')).toBe(filename);
      fs.writeFileSync(current, 'new package');
      await cleanMsixOutput(outDir, '1.1.0', { DOT_MSIX_VERIFICATION_REVISION: '1' });
      expect(fs.existsSync(current)).toBe(false);
      await expect(cleanMsixOutput(outDir, '1.1.0', {})).resolves.toBeUndefined();
      await expect(cleanMsixOutput(outDir, '../outside', {})).rejects.toThrow();
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  test('検証パッケージは Store の設定を流用しない', () => {
    expect(packageIdentity({ DOT_MSIX_IDENTITY_NAME: 'Official.Product', DOT_MSIX_PUBLISHER: 'CN=Official' })).toMatchObject({ name: 'dot.Verification', publisher: 'CN=dot Verification, OID.2.25.311729368913984317654407730594956997722=1', channel: 'verification' });
    const manifest = renderManifest(template, packageIdentity({}), '1.1.0');
    expect(manifest).toContain('Publisher="CN=dot Verification, OID.2.25.311729368913984317654407730594956997722=1"');
  });

  test('Store モードは正式な識別情報が揃うまで作成できない', () => {
    expect(() => packageIdentity({ DOT_MSIX_CHANNEL: 'store' })).toThrow('DOT_MSIX_IDENTITY_NAME');
    expect(() => packageIdentity({ DOT_MSIX_CHANNEL: 'unknown' })).toThrow('DOT_MSIX_CHANNEL');
    expect(() => packageIdentity({ DOT_MSIX_CHANNEL: 'store', DOT_MSIX_IDENTITY_NAME: 'dot.Verification', DOT_MSIX_PUBLISHER: 'CN=dot Verification', DOT_MSIX_PUBLISHER_DISPLAY_NAME: 'Verification' })).toThrow('検証用');
    expect(() => packageIdentity({ DOT_MSIX_CHANNEL: 'store', DOT_MSIX_IDENTITY_NAME: 'Official.Product', DOT_MSIX_PUBLISHER: 'CN=Official, OID.2.25.311729368913984317654407730594956997722=1', DOT_MSIX_PUBLISHER_DISPLAY_NAME: 'Official' })).toThrow('unsigned');
  });

  test('正式な publisher の DN と表示名を XML 属性・本文として保存する', () => {
    const identity = packageIdentity({ DOT_MSIX_CHANNEL: 'store', DOT_MSIX_IDENTITY_NAME: 'Official.Product', DOT_MSIX_PUBLISHER: 'CN=Publisher & Co, O="Studio"', DOT_MSIX_PUBLISHER_DISPLAY_NAME: 'Publisher & Co' });
    const manifest = renderManifest(template, identity, '1.2.3');
    expect(manifest).toContain('Publisher="CN=Publisher &amp; Co, O=&quot;Studio&quot;"');
    expect(manifest).toContain('<PublisherDisplayName>Publisher &amp; Co</PublisherDisplayName>');
    expect(manifest).not.toContain('OID.2.25.311729368913984317654407730594956997722');
    expect(manifest).toContain('Version="1.2.3.0"');
  });

  test('Store の予約桁を 0 とし、未対応の版を拒否する', () => {
    expect(msixVersion('1.1.0')).toBe('1.1.0.0');
    for (const version of ['1.2.3-beta.1', '1.2.3.4', '0.1.0', '1.65536.0']) expect(() => msixVersion(version)).toThrow();
  });

  test('検証版の revision だけを指定でき、未指定なら 0 を使う', () => {
    expect(verificationRevision('verification', {})).toBe(0);
    for (const revision of ['0', '1', '65535']) {
      const value = verificationRevision('verification', { DOT_MSIX_VERIFICATION_REVISION: revision });
      expect(renderManifest(template, packageIdentity({}), '1.1.0', value)).toContain(`Version="1.1.0.${revision}"`);
    }
    for (const revision of ['', '-1', '1.5', '1e2', 'NaN', '65536', ' 1']) expect(() => verificationRevision('verification', { DOT_MSIX_VERIFICATION_REVISION: revision })).toThrow('0..65535');
    for (const revision of [-1, 0.1, Number.NaN, 65536]) expect(() => msixVersion('1.1.0', revision)).toThrow('revision');
  });

  test('Store 版の revision は常に 0 とし、非ゼロ指定を拒否する', () => {
    expect(verificationRevision('store', {})).toBe(0);
    expect(verificationRevision('store', { DOT_MSIX_VERIFICATION_REVISION: '0' })).toBe(0);
    expect(() => verificationRevision('store', { DOT_MSIX_VERIFICATION_REVISION: '1' })).toThrow('常に 0');
    const identity = packageIdentity({ DOT_MSIX_CHANNEL: 'store', DOT_MSIX_IDENTITY_NAME: 'Official.Product', DOT_MSIX_PUBLISHER: 'CN=Official', DOT_MSIX_PUBLISHER_DISPLAY_NAME: 'Official' });
    expect(renderManifest(template, identity, '1.1.0')).toContain('Version="1.1.0.0"');
    expect(() => renderManifest(template, identity, '1.1.0', 1)).toThrow('常に 0');
  });

  test('Win11、console Alias、ホスト登録キーだけの仮想化除外を宣言する', () => {
    const manifest = renderManifest(template, packageIdentity({}), '1.1.0');
    expect(manifest).toContain('MinVersion="10.0.22000.0"');
    expect(manifest).toContain('Executable="app\\dot-native-host.exe"');
    expect(manifest).toContain('desktop4:Subsystem="console"');
    expect(manifest).toContain('desktop4:SupportsMultipleInstances="true"');
    expect(manifest).toContain('Alias="dot-native-host.exe"');
    expect(manifest).toContain('HKEY_CURRENT_USER\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.dot.host');
    expect(manifest.match(/<virtualization:ExcludedKey>/g)).toHaveLength(1);
    expect(manifest).toContain('Name="unvirtualizedResources"');
    expect(manifest).not.toContain('>disabled<');
    expect(manifest).not.toContain('{{');
  });
});
