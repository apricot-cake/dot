import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://apricot-cake.com',
  base: '/dot',
  output: 'static',
  trailingSlash: 'always',
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('../../app/src/renderer/src', import.meta.url)) },
      dedupe: ['react', 'react-dom', '@base-ui/react', 'class-variance-authority', 'clsx', 'tailwind-merge', 'lucide-react'],
    },
  },
});
