// ゴミ箱の service＝やわらかく削除したレコードへの命令（一覧／復元／完全に削除／空にする）を、
// 平たい dotIpc.listTrash/restorePost/deleteFromTrash/emptyTrash の呼び出しに被せたもの
// （P4 の「IPC → service」の領域ごとのまとめの一部＝BACKLOG の「手書きの .js をゼロにし、
// React で本番の作りにする」）。本物の ES モジュール（名前付きの export）で、設定 > ゴミ箱の
// コンポーネント（settings/sections/Trash.tsx）が直接 import する。window.dot へ直接手を
// 伸ばす代わりに、領域としての住処を与えるもの＝純粋な1対1の転送で、包むロジックは無い
// （tab-state や folders と違い、ゴミ箱には持つべき直列化や検査の段が無い）。
import { dotIpc } from './ipc.ts';

export function listTrash() {
  return dotIpc.listTrash();
}
export function restorePost(image: string) {
  return dotIpc.restorePost(image);
}
export function deleteFromTrash(image: string) {
  return dotIpc.deleteFromTrash(image);
}
export function emptyTrash() {
  return dotIpc.emptyTrash();
}
