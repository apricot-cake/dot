export const BACKGROUND_LAUNCH_FLAG = '--dot-background';

export function hideBackgroundWindows(argv: readonly string[], env: NodeJS.ProcessEnv): boolean {
  return isBackgroundLaunch(argv, env);
}

export function isBackgroundLaunch(argv: readonly string[], env: NodeJS.ProcessEnv): boolean {
  return argv.includes(BACKGROUND_LAUNCH_FLAG) || ['DOT_START_MINIMIZED', 'DOT_START_INACTIVE', 'DOT_E2E_HIDDEN'].some((key) => env[key] === '1');
}

export function backgroundRelaunchArgs(argv: readonly string[]): string[] {
  const args: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (/^--(?:remote-debugging-(?:port|address|pipe)|inspect(?:-brk)?)(?:=|$)/.test(arg)) {
      if (!arg.includes('=') && arg !== '--remote-debugging-pipe' && argv[i + 1] && !argv[i + 1].startsWith('--')) i++;
      continue;
    }
    if (arg !== BACKGROUND_LAUNCH_FLAG) args.push(arg);
  }
  return [...args, BACKGROUND_LAUNCH_FLAG];
}
