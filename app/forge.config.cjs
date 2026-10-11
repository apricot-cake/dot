const path = require('node:path');

const root = __dirname;

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
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'dot',
        title: 'dot',
        authors: 'apricot-cake',
        description: 'dot desktop viewer',
        exe: 'dot.exe',
        noMsi: true,
        setupExe: 'dotSetup.exe',
        setupIcon: path.join(root, 'assets', 'icon.ico'),
      },
    },
  ],
  publishers: [
    {
      name: '@electron-forge/publisher-github',
      config: {
        repository: {
          owner: 'apricot-cake',
          name: 'dot',
        },
        draft: true,
      },
    },
  ],
};
