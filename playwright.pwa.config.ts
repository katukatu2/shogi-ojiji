import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/pwa', outputDir: 'logs/pwa/test-results',
  timeout: 60_000, expect: { timeout: 20_000 }, retries: 0, workers: 2,
  use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, serviceWorkers: 'allow', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  reporter: [['list'], ['html', { outputFolder: 'logs/pwa/report', open: 'never' }], ['json', { outputFile: 'logs/pwa/results.json' }]],
  projects: [
    { name: 'static-no-headers', use: { baseURL: 'http://localhost:5180' } },
    { name: 'static-with-headers', use: { baseURL: 'http://localhost:5181' } },
  ],
  webServer: [
    { command: 'node scripts/serve-static.mjs 5180 --faults', url: 'http://localhost:5180', reuseExistingServer: !process.env.CI },
    { command: 'node scripts/serve-static.mjs 5181 --isolated --faults', url: 'http://localhost:5181', reuseExistingServer: !process.env.CI },
  ],
});
