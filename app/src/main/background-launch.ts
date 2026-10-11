export const BACKGROUND_LAUNCH_FLAG = '--dot-background';

export function hideBackgroundWindows(argv: readonly string[], env: NodeJS.ProcessEnv): boolean {
  return isBackgroundLaunch(argv, env);
}

export function isBackgroundLaunch(argv: readonly string[], env: NodeJS.ProcessEnv): boolean {
  return argv.includes(BACKGROUND_LAUNCH_FLAG) || ['DOT_START_MINIMIZED', 'DOT_START_INACTIVE', 'DOT_E2E_HIDDEN'].some((key) => env[key] === '1');
}

export function backgroundRelaunchArgs(argv: readonly string[]): string[] {
  return [...argv.filter((arg) => arg !== BACKGROUND_LAUNCH_FLAG), BACKGROUND_LAUNCH_FLAG];
}
