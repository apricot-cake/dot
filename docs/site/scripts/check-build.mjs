import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root = resolve('dist');
const pages = ['index.html', 'privacy/index.html'];
for (const page of pages) {
  const html = readFileSync(join(root, page), 'utf8');
  assert.match(html, /<html[^>]+lang="ja"/);
  assert.match(html, /rel="canonical"/);
  assert.doesNotMatch(html, /Hologram|hologram|localhost|C:\\Users|<iframe|google-analytics|googletagmanager/);
  for (const match of html.matchAll(/(?:href|src)="([^"#]+)"/g)) {
    const url = match[1].split(/[?#]/)[0];
    if (!url.startsWith('/dot/')) continue;
    const relative = decodeURIComponent(url.slice('/dot/'.length));
    const target = join(root, relative.endsWith('/') ? `${relative}index.html` : relative);
    assert.ok(existsSync(target), `${page}: ${url} が見つかりません`);
  }
}
assert.ok(!existsSync(join(root, 'en')), '英語ページを出力しません');
assert.ok(existsSync(join(root, 'og.png')));
assert.ok(existsSync(join(root, 'icon.png')));
const scripts = readdirSync(join(root, '_astro')).filter((name) => name.endsWith('.js'));
for (const name of scripts) {
  const js = readFileSync(join(root, '_astro', name), 'utf8');
  assert.doesNotMatch(js, /better-sqlite3|nativeMessaging|window\.api|ipcRenderer/);
}
console.log('日本語ページ、ローカル参照、公開用画像、ブラウザ依存の検査に合格しました。');
