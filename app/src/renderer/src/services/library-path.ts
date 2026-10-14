// ライブラリのパスの service（#37）＝get-library-status /
// pick-repoint-folder / apply-repoint を、平たい dotIpc の呼び出しに被せた
// もの。純粋な1対1の転送（backup.ts / posts.ts と同じ形）で、empty/LibraryMissingState.tsx、
// dotStore の 'libraryMissing' キーへ種を入れる App 階層の状態のゲート、
// settings/sections/Data.tsx の「ライブラリ」のカードが import する。
import { dotIpc } from './ipc.ts';

// 必ずその場で調べる（main は statSync を走らせ、キャッシュしたフラグは使わない）＝押し込みを
// 期待せず、再試行や付け替えの後にもう一度これを呼ぶ。
export function getLibraryStatus() {
  return dotIpc.getLibraryStatus();
}
// #71: 拡張機能が一度でも接触したか（導入され、確認か保存を少なくとも1回処理したか）＝
// App.tsx の起動時のゲートがこれで dotStore の 'extensionContacted' に種を入れ、
// empty/EmptyState.tsx がそれを読んで、導入の案内と通常の firstRun の変種を選び分ける。
export function getExtensionContact() {
  return dotIpc.getExtensionContact();
}
// 既存のライブラリのフォルダを選び、作成や復元をせずに検証する。
export function pickRepointFolder() {
  return dotIpc.pickRepointFolder();
}
// `dest` を復旧したライブラリとして開く＝アプリの足元で消えてしまった
// 保存フォルダのための脱出口（services/posts.ts の pickSaveFolder/moveSaveFolder は、今の
// フォルダがコピー元としてそこにあることを前提にしている）。
export function applyRepoint(dest: string) {
  return dotIpc.applyRepoint(dest);
}
