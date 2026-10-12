import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const site = fileURLToPath(new URL('../', import.meta.url));

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  const image = (path) => `data:image/${path.endsWith('.webp') ? 'webp' : path.endsWith('.jpg') ? 'jpeg' : 'png'};base64,${readFileSync(resolve(site, path)).toString('base64')}`;
  await page.setContent(`<!doctype html><html lang="ja"><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;width:1200px;height:630px;background:#fafbfc;color:#33333d;font-family:'Yu Gothic','Meiryo',sans-serif;display:flex;align-items:center;padding:70px;gap:55px}.copy{width:530px}.brand{display:flex;align-items:center;gap:20px;font-family:system-ui,sans-serif;font-size:70px;font-weight:700;letter-spacing:-4px}.brand img{width:80px;height:80px}.tag{display:inline-block;margin:35px 0 23px;background:#eeedf7;border-radius:99px;padding:10px 20px;font-size:19px;color:#565469}h1{font-size:39px;line-height:1.7;letter-spacing:1px;margin:0;font-weight:600}p{font-size:19px;color:#525252;line-height:1.8}.art{width:410px;height:470px;background:#fff;border-radius:40px;padding:18px;box-shadow:0 14px 55px #b8aec81f}.art img{width:100%;height:100%;object-fit:cover;border-radius:28px}
    </style><body><div class="copy"><div class="brand"><img src="${image('public/icon.png')}" alt="">dot</div><div class="tag">イラストのためのライブラリ</div><h1>そのイラスト、<br>投稿ごと残そう</h1><p>本文や作者も、探す手がかりに。</p></div><div class="art"><img src="${image('public/demo/qingque.webp')}" alt=""></div></body></html>`);
  await page.locator('img').evaluateAll((images) => Promise.all(images.map((image) => image.decode())));
  await page.screenshot({ path: resolve(site, 'public/og.png') });
  console.log('OGP画像を1200×630で生成しました。');
} finally {
  await browser.close();
}
