# dot のプロダクトページ

Astro の静的ページに、React の操作再生デモを埋め込みます。日本語・ライト表示のみです。ページの説明とプライバシーポリシーは、JavaScript を無効にしても読めます。

## 開発と検証

リポジトリのルートで実行します。

```powershell
npm ci --prefix docs/site
npm run site:dev
```

公開用ビルドと操作の検証は次のコマンドで行います。

```powershell
npm run site:check
npm run site:build
npm run site:test
```

操作テストは Playwright の Chromium を背面で使います。初回だけ `npm exec --prefix docs/site -- playwright install chromium` で用意してください。日常用 Chrome や開発用プロファイルには接続しません。

## ページと素材

- `/dot/`: プロダクトページと操作デモ。
- `/dot/privacy/`: `docs/PRIVACY.md` を直接取り込んだプライバシーポリシー。
- `src/data/demo.ts`: 再生工程と表示用サンプル。再生状態はメモリ内だけに保持します。自動ループし、工程を選ぶとその工程の先頭から再生します。キーボード操作中は停止します。動きを減らす設定ではカーソル移動と文字入力のアニメーションを省き、工程のみ切り替えます。
- `public/demo/`: アプリコットケーキの作品画像。投稿本文・作者のハンドル・日時・反応数は表示用サンプルです。
- `public/og.png`: 1200 × 630 の共有用画像。更新はこのディレクトリで `node scripts/generate-og.mjs` を実行します。

デモはアプリの PostCard、AuthorLine、デザイントークンを共有します。投稿保存時に記録する本文・作者・元URLを見せ、保存した本文のキャラ名で検索します。日本語入力は、ひらがなの入力、漢字への変換、確定の順に表示します。手動タグ付けは検索の前提にしません。保存、ファイル操作、データベース、Native Messaging には接続しません。

## 公開

`.github/workflows/website.yml` がページと共有部品を検査します。main の変更は GitHub Pages へ配信します。リポジトリの Pages の Source を GitHub Actions に設定する必要があります。

予定 URL は `https://apricot-cake.com/dot/` です。ストアの公開 URL が確定するまでは、ストアボタンを無効なプレースホルダーとして表示します。紹介動画は未制作のため掲載していません。

ストアバッジは公式配布素材を改変せずに使います。Microsoftは `https://get.microsoft.com/images/ja%20dark.svg`、Chromeは `https://developer.chrome.com/docs/webstore/branding` のmedium PNG（枠あり）です。商品URLが確定するまでは無効ボタンで表示します。

機能説明の図は、実アプリの構造に合わせて共通部品と静的HTMLで再現しています。実アプリの画面キャプチャではありません。投稿者一覧の「みずたま」「こもれび」は架空のサンプルです。
