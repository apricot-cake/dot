const path = require('node:path');

const root = __dirname;
const { prepareMsix, cleanMsixOutput } = require('./msix/config.cjs');

module.exports = {
  outDir: path.join(root, 'artifacts'),
  packagerConfig: {
    asar: {
      unpack: '*.node',
      unpackDir: 'node_modules/{sharp,@img}',
    },
    icon: path.join(root, 'assets', 'icon'),
    extraResource: [path.join(root, '..', 'native-host'), path.join(root, 'vendor', 'meilisearch'), path.join(root, 'vendor', 'avif')],
  },
  rebuildConfig: {},
  hooks: { preMake: () => cleanMsixOutput(path.join(root, 'artifacts'), require('./package.json').version) },
  makers: [{ name: '@electron-forge/maker-msix', config: prepareMsix }],
  publishers: [],
};
