import { getWindowsPackageData } from './windows-app-data.mts';

export const MSIX_NATIVE_HOST = 'com.dot.host';
export const WORKSPACE_NATIVE_HOST = 'com.dot.host.workspace';
export const SANDBOX_NATIVE_HOST = 'com.dot.host.sandbox';

export function nativeHostName(): string {
  const requested = process.env.DOT_NATIVE_HOST_NAME;
  if (getWindowsPackageData()) {
    if (requested && requested !== MSIX_NATIVE_HOST) throw new Error('MSIX cannot overwrite workspace or sandbox native host registration');
    return MSIX_NATIVE_HOST;
  }
  if (requested && requested !== WORKSPACE_NATIVE_HOST && requested !== SANDBOX_NATIVE_HOST) throw new Error('Unpackaged runtime requires the workspace or sandbox native host');
  return requested || (process.env.DOT_CONFIG_DIR ? SANDBOX_NATIVE_HOST : WORKSPACE_NATIVE_HOST);
}
