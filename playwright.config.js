const { defineConfig, devices } = require('@playwright/test');

const externalBaseUrl = process.env.E2E_BASE_URL;

module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 20_000,
  expect: { timeout: 7_000 },
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: externalBaseUrl || 'http://127.0.0.1:4173',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    ...devices['Desktop Chrome']
  },
  webServer: externalBaseUrl ? undefined : {
    command: 'npm run serve:e2e',
    url: 'http://127.0.0.1:4173/trade.html',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000
  },
  outputDir: 'test-results'
});
