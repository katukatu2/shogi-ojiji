import { defineConfig } from '@playwright/test';

// Playwright の E2E テスト（tests/e2e/*.spec.ts）。
// vite dev を 5179 番で起動して、Chromium・WebKit のスマートフォン相当の画面（375×667）で確かめる。
// vite.config.ts が COOP/COEP ヘッダーを付けるので、やねうら王（WASM、SharedArrayBuffer）も headless Chromium で動くはず。
// 動かなければ「判定: 簡易」で進むだけなので、テストはエンジンの有無に依存しないように書いてある。
// 結果・トレース・レポートは logs/e2e/（git 管理外）に置く。

const PORT = 5179;

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'logs/e2e/test-results',
  timeout: 60_000, // 1 テスト。オジジの応手をエンジンで待つ場面が数回ある
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: process.env.CI ? 1 : 2, // エンジンが WASM のスレッドを使うので、並列は控えめに
  reporter: [
    ['list'],
    ['html', { outputFolder: 'logs/e2e/report', open: 'never' }],
  ],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 375, height: 667 },
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // dev サーバーが COOP/COEP を付けるので、coi-serviceworker.js の出番はない。
    // 試験ごとの状態を単純にするため Service Worker は止めておく
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
