import { defineConfig } from '@playwright/test';

// npm run build 済みの製品を、独立した保存領域と実エンジンで詰みまで操作する。
export default defineConfig({
  testDir: 'tests/fullgame',
  outputDir: 'logs/fullgame/test-results',
  timeout: 15 * 60_000,
  globalTimeout: 20 * 60_000,
  expect: { timeout: 30_000 },
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'logs/fullgame/report', open: 'never' }]],
  use: {
    browserName: 'chromium',
    baseURL: 'http://127.0.0.1:5182',
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'allow',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  globalSetup: './tests/fullgame/setup.mjs',
});
