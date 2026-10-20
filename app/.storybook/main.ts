import type { StorybookConfig } from '@storybook/react-vite';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { libraryPreviewPlugin } from './library-server.ts';

const config: StorybookConfig = {
  stories: ['../src/renderer/src/**/*.stories.tsx'],
  framework: '@storybook/react-vite',
  core: { disableTelemetry: true },
  async viteFinal(config) {
    const { mergeConfig } = await import('vite');
    return mergeConfig(config, {
      resolve: { alias: { '@': fileURLToPath(new URL('../src/renderer/src', import.meta.url)) } },
      // Windows で配備ディレクトリを監視すると、app:deploy の rename を妨げる。
      server: { host: '127.0.0.1', cors: false, watch: { ignored: ['**/out', '**/out/**', '**/storybook-static', '**/storybook-static/**', '**/.deploy-*', '**/.deploy-*/**'] } },
      plugins: [
        tailwindcss(),
        libraryPreviewPlugin(),
        {
          name: 'dot:storybook-assets',
          enforce: 'pre',
          resolveId(source: string, importer?: string) {
            if (source === 'virtual:dot-extension-notifications') return fileURLToPath(new URL('./extension-notifications.runtime.ts', import.meta.url));
            if (source.endsWith('/asset-src.ts') && !importer?.replaceAll('\\', '/').includes('/.storybook/asset-src.ts')) return fileURLToPath(new URL('./asset-src.ts', import.meta.url));
            if (source.endsWith('/use-oriented-image.ts')) return fileURLToPath(new URL('./use-oriented-image.ts', import.meta.url));
          },
        },
      ],
    });
  },
};

export default config;
