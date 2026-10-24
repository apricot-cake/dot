# dot のネイティブ メッセージングホスト

このディレクトリには、Chrome 拡張機能とローカルライブラリをつなぐネイティブ メッセージングホストがあります。Chrome は [`chrome.runtime.connectNative`](https://developer.chrome.com/docs/extensions/reference/api/runtime#method-connectNative) を通じてホストを起動します。デスクトップアプリを閉じている間も投稿を保存できます。

## 保存するデータ

拡張機能は、保存操作ごとに原本メディアの URL とメタデータを含むリクエストを送ります。ホストは利用者が選んだライブラリに、投稿のファイルと取り込みレコードを書き込みます。

```text
items/<captureId>/  投稿の原寸画像、動画、動画のポスターなど
.dot-inbox/    アプリがデータベースへ反映する取り込みキュー
```

ホストは既存の項目ファイルを変更しません。削除、編集、DB の更新はデスクトップアプリが担当します。保存済み判定用の索引はアプリが更新し、消失・破損した場合はホストが DB を読み取り専用で開いて再構築します。

## 主なファイル

| ファイル | 役割 |
| --- | --- |
| `bridge.mts` | 標準入出力でネイティブ メッセージングの JSON を読み書きする起動用のファイルです。 |
| `item-storage.mts` | `items/<captureId>/` のディレクトリと安全な相対パスを作ります。 |
| `protocol.mts` | 拡張機能とホストが共有するリクエスト、応答、エラー、プロトコルバージョンを定義します。 |
| `paths.mts` | アプリとホストで設定・キャッシュ・ログの保存先を解決します。 |
| `saved-index.mts` | アプリとホストで共有する保存済み索引の構築規則です。 |
| `host-environment.mts` | MSIX・主作業ツリー・隔離検証のホスト名を分離します。 |
| `media-download.mts` | メディアをダウンロードし、接続先、サイズ、件数、時間を制限します。 |
| `config-recovery.mts` | 保存先を復旧し、破壊的な操作を防ぎます。 |
| `install.mts` | Chrome 用のホストマニフェストを登録または削除します。 |
| `com.dot.host.json` | `install.mts` が生成するホストマニフェストのひな形です。 |

ソースは ESM の `.mts` ファイルです。Node.js の型除去を使うため、開発時はコンパイルせずに実行できます。`install.mts` は Electron アプリからも読み込みます。Electron 側は CommonJS のバンドルですが、Node.js の `require(esm)` で同期的に読み込みます。詳しい理由は `native-host/tsconfig.json` に記載しています。

## 共有プロトコル

`protocol.mts` は保存、問い合わせ、診断のリクエストと応答、キャプチャ ID の規則、プロトコルバージョンを定義します。拡張機能もこのファイルを直接 import し、Vite が拡張機能のバンドルへ組み込みます。このため、`protocol.mts` は Node.js の組み込みモジュールを利用できません。`post-record.mts` からの import も型だけに限定しています。

ホストはすべての応答にプロトコルバージョンを含めます。拡張機能とデスクトップアプリは別々に更新されるため、両者のバージョンが一時的に異なることがあります。バージョンが異なる場合は、更新が必要な側を利用者へ案内します。バージョンの違いだけを理由に保存を拒否することはありません。

## ビルドと配置

`app/build-native-host-bridge.mjs` は `bridge.mts` と依存関係を `native-host/dist/bridge.js` へバンドルします。主作業ツリーでは設定ディレクトリにバンドルとランチャーを配置します。Windows API を呼ぶ Koffi はネイティブ依存として残し、ランチャーの `NODE_PATH` でアプリの依存を参照します。

MSIX 版では、パッケージ内の専用コンソール入口を `dot-native-host.exe` の App Execution Alias から起動します。入口は同じパッケージの Electron を `ELECTRON_RUN_AS_NODE` モードで実行し、標準入出力を継承して `resources/native-host/dist/bridge.js` を開始します。ホストのコードを `LocalState` へ複写しません。

同じビルドスクリプトは、`media-download.mts` を `native-host/dist/media-download.js` へ個別にバンドルします。パッケージ化した Electron アプリは、投稿をインポートするときのメディア取得にこのファイルを使います。パッケージ内には隣接する `node_modules` がないため、依存関係もバンドルへ含めます。開発時のアプリはソースを直接読み込むため、このバンドルを使いません。

## 設定

保存先は `<configDir>/config.json` に記録します。実行環境ごとの登録と設定を分けます。

| 実行環境 | ホスト名 | 設定 |
| --- | --- | --- |
| 主作業ツリー | `com.dot.host.workspace` | `%APPDATA%\dot-Workspace\config.json` |
| 隔離検証 | `com.dot.host.sandbox` | 検証コマンドが所有する `DOT_CONFIG_DIR` |
| MSIX | `com.dot.host` | Windows API が返す `LocalState\config.json` |

ホスト manifest は設定ディレクトリ内の `NativeMessaging` に配置します。保存済み索引とジャーナルは `cacheDir()`、ログは `logsDir()` を使います。MSIX ではそれぞれ `LocalCache` と `LocalCache\Logs` です。主作業ツリーでは `%LOCALAPPDATA%\dot-Workspace` 内に分けます。

`pnpm run ext:dev:register` は普段のライブラリへ接続する workspace ホストを登録します。ローカル配備した共有拡張機能も workspace を既定に使います。検証用タブは sandbox ホストへ接続し、一つの検証コマンドだけが登録を管理し、終了時に解除します。Store 用拡張機能の既定は MSIX ホストです。

既存の設定やライブラリを自動移動する処理はありません。

```json
{ "saveFolder": "D:\\dot" }
```

デスクトップアプリで選んだフォルダの下に `dot\Library` を作り、その場所を `saveFolder` に記録します。`dot` フォルダを選んだ場合はその下の `Library` を使い、`Library` フォルダ自体を選んだ場合はそのまま使います。設定がない場合は `~/dot/Library` を使います。設定ディレクトリは `DOT_CONFIG_DIR` で変更できます。

## 開発環境へ手動で登録する

手動登録には、`PATH` から実行できる Node.js が必要です。先にホストをバンドルしてください。バンドルがない場合、`install.mts` は登録を中止します。

```powershell
pnpm run app:build
node native-host/install.mts <extensionId>
node native-host/install.mts uninstall
```

デスクトップアプリは、初回起動時にホストを自動登録します。`ELECTRON_RUN_AS_NODE` で同梱した実行ファイルを使うため、利用者が Node.js を別途インストールする必要はありません。

## 拡張機能 ID

ホストマニフェストの `allowed_origins` には、接続を許可する拡張機能 ID が必要です。ローカル拡張機能は `extension/wxt.config.ts` の署名鍵で ID を固定します。Store の拡張機能 ID は登録後に確定し、その ID による製品版の接続確認は別途必要です。ID は `chrome://extensions` で確認できます。

デスクトップアプリに ID を設定すると、`config.json` の `extensionId` に保存されます。アプリはホストマニフェストの接続元を `chrome-extension://<id>/` に更新します。ID を設定するまで `allowed_origins` は空で、Chrome は接続を拒否します。
