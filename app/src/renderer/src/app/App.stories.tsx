import { lazy, Suspense } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { installLibraryPreload } from '../../../../.storybook/library-preload.ts';

const BrowserApp = lazy(async () => {
  // サービスが import 時に設定を読むため、実ライブラリの読み取りを先に完了する。
  await installLibraryPreload();
  const [{ App }, { Outlet, RouterProvider }, navigation, { initI18n }] = await Promise.all([import('./App.tsx'), import('@tanstack/react-router'), import('../services/navigation-router.ts'), import('../_shared/i18n.ts')]);
  const i18n = await initI18n();
  document.documentElement.lang = i18n?.resolved ?? 'ja';
  navigation.configureNavigationRoot(function NavigationRoot() {
    return (
      <>
        <App />
        <Outlet />
      </>
    );
  });
  return { default: () => <RouterProvider router={navigation.getNavigationRouter()} /> };
});

function ScreenPreview() {
  return (
    <Suspense fallback={<p role="status">画面を読み込んでいます…</p>}>
      <BrowserApp />
    </Suspense>
  );
}

const meta = {
  id: 'dot-screen',
  title: 'dot/画面',
  component: ScreenPreview,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ScreenPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Library: Story = { name: 'ライブラリ' };
