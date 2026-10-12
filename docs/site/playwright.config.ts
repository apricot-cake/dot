export default {
  testDir: './tests',
  fullyParallel: true,
  use: { baseURL: 'http://127.0.0.1:4330/dot/', headless: true },
  webServer: {
    command: 'npm run preview -- --port 4330',
    url: 'http://127.0.0.1:4330/dot/',
    reuseExistingServer: !process.env.CI,
  },
};
