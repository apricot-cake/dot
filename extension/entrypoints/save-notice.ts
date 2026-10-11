import { installWebSaveNotices } from '../utils/web-save-notices.ts';

export default defineUnlistedScript(() => {
  const state = globalThis as typeof globalThis & { dotWebSaveNotices?: boolean };
  if (state.dotWebSaveNotices) return;
  state.dotWebSaveNotices = true;
  installWebSaveNotices();
});
