import type { Preview } from '@storybook/react-vite';
import '../src/renderer/design-tokens.css';
import '../src/renderer/src/globals.css';

const preview: Preview = {
  parameters: { layout: 'fullscreen', controls: { disable: true } },
};

export default preview;
