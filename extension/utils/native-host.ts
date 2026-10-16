declare const __NATIVE_HOST_DEFAULT__: 'workspace' | 'msix' | undefined;
export const DEFAULT_NATIVE_HOST_PROFILE = typeof __NATIVE_HOST_DEFAULT__ === 'undefined' ? 'msix' : __NATIVE_HOST_DEFAULT__;
export const RELEASE_NATIVE_HOST = 'com.dot.host';
export const WORKSPACE_NATIVE_HOST = 'com.dot.host.workspace';
export const SANDBOX_NATIVE_HOST = 'com.dot.host.sandbox';
export const NATIVE_HOST_PROFILE_KEY = 'nativeHost.profile.v1';
export const WORKSPACE_NATIVE_HOST_PROFILE = 'workspace';
export const SANDBOX_NATIVE_HOST_PROFILE = 'sandbox';

// 接続先は Chrome プロファイルの用途ではなく、アプリの実行環境で選ぶ。
// Store 版を既定とし、管理された主作業ツリーの拡張機能は workspace を明示する。
export function nativeHostForProfile(profile: unknown): string {
  return profile === WORKSPACE_NATIVE_HOST_PROFILE ? WORKSPACE_NATIVE_HOST : profile === SANDBOX_NATIVE_HOST_PROFILE ? SANDBOX_NATIVE_HOST : DEFAULT_NATIVE_HOST_PROFILE === 'workspace' ? WORKSPACE_NATIVE_HOST : RELEASE_NATIVE_HOST;
}

export function getNativeHost(): Promise<string> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return Promise.resolve(nativeHostForProfile(undefined));
  return new Promise((resolve) => {
    chrome.storage.local.get(NATIVE_HOST_PROFILE_KEY, (stored) => {
      if (chrome.runtime.lastError) {
        resolve(nativeHostForProfile(undefined));
        return;
      }
      resolve(nativeHostForProfile(stored?.[NATIVE_HOST_PROFILE_KEY]));
    });
  });
}
