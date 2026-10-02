import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test',
  testMatch: '**/*.spec.mjs',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure'
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1200, height: 900 } } },
    { name: 'mobile', use: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } }
  ],
  webServer: [{
    command: 'python3 -m http.server 4173 --bind 127.0.0.1 --directory .',
    url: 'http://127.0.0.1:4173/web/index.html',
    reuseExistingServer: false,
    timeout: 30_000
  }, {
    command: 'python3 -m http.server 4174 --bind 127.0.0.1 --directory web',
    url: 'http://127.0.0.1:4174/',
    reuseExistingServer: false,
    timeout: 30_000
  }]
});
