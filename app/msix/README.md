# MSIX の作成

この文書では、Microsoft Store 向けのパッケージと、手元で動作確認するための検証用パッケージの作成方法を説明します。配布方針と確認状況は [配布とストア提出](../../docs/配布とストア提出.md) を参照してください。

検証用パッケージを同じパッケージファミリ名（PFN）のまま更新する場合は、`DOT_MSIX_VERIFICATION_REVISION` に `0..65535` の整数を指定します。未指定は `0` です。たとえばアプリの版が `1.1.0` で revision が `1` なら manifest の版は `1.1.0.1` になります。Store モードは常に末尾 `0` とし、非ゼロ指定を拒否します。

Windows x64 と Windows SDK `10.0.26100.0`、Visual Studio C++ Build Tools を使います。アプリの最低 Windows ビルドは `10.0.22000.0` です。SDK の版はインストール要件とは別に管理します。

リポジトリのルートで `pnpm run app:make` を実行すると、`app/artifacts/make/msix/x64/` に MSIX が出力されます。公式 `@electron-forge/maker-msix` `8.0.1` で MSIX を作成します。パッケージ作成時に `dot-native-host.exe` をコンパイルし、同梱の Electron を Node モードで起動するコンソールプログラムとして配置します。Chrome の標準入出力を継承し、コンソールプログラムの終了時には子プロセスも終了します。

既定は検証専用の `dot.Verification` / `CN=dot Verification, OID.2.25.311729368913984317654407730594956997722=1` です。末尾の OID は Windows の unsigned パッケージ用識別子で、Store の製品を表す識別情報ではありません。検証パッケージも `dot-native-host.exe` の Alias と `dot:` を登録するため、別の MSIX 版と同時に有効化せず、主担当の検証手順で登録と解除を管理します。

Store 向けの作成では、次の環境変数に Partner Center の正式な値を指定します。

| 変数 | 値 |
| --- | --- |
| `DOT_MSIX_CHANNEL` | `store` |
| `DOT_MSIX_IDENTITY_NAME` | Package Identity Name |
| `DOT_MSIX_PUBLISHER` | `CN=` で始まる完全な Publisher |
| `DOT_MSIX_PUBLISHER_DISPLAY_NAME` | Publisher Display Name |
| `CHROME_EXTENSION_ID` | Chrome ウェブストアに登録した正式な拡張機能 ID（`a-p` の32文字） |

Store 用パッケージには `resources/native-host/distribution.json` を生成し、正式な拡張機能 ID を同梱します。初回起動時に利用者の設定へ ID がなくても、この値から Chrome の接続許可を登録します。ソースの `native-host/` には生成しません。検証用パッケージには ID を含めず、正式 ID が未登録でも検証を続けられます。Store モードでは上記の設定が揃わなければ、依存展開・ホスト入口のビルドより前に停止します。

署名は自動実行しません。検証用の証明書を暗黙に生成せず、Store 用の識別情報も推定しません。Windows 11 の検証専用 MSIX は `Add-AppxPackage -Path <検証MSIX> -AllowUnsigned` で導入できます。実行ファイルを含むため、この導入には管理者権限が必要です。証明書の信頼登録は行いません。Store モードには unsigned 用 OID を含めず、正式な Publisher をそのまま使います。[unsigned パッケージの公式手順](https://learn.microsoft.com/en-us/windows/msix/package/unsigned-package)

`DOT_MSIX_WINDOWS_KIT_VERSION` で使用する SDK の版を上書きできます。`unvirtualizedResources` の Store 承認は、パッケージ作成の成功とは別に必要です。除外するレジストリは `com.dot.host` の登録キーだけです。
