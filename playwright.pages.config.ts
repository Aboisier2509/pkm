import { defineConfig } from '@playwright/test';

/** A separate smoke test for a GitHub Pages project path; never runs the full suite. */
export default defineConfig({
  testDir: './tests/hosting',
  testMatch: '**/github-pages.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  forbidOnly: !!process.env.CI,
  retries: 0,
  outputDir: './test-results-pages',
  reporter: [['list'], ['html', { open: 'never', outputFolder: './playwright-report-pages' }]],
  use: {
    baseURL: 'http://localhost:4184',
    headless: true,
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'pages-chrome', use: { channel: 'chrome', browserName: 'chromium' } }],
  webServer: {
    command: 'node scripts/preview-pages-tests.mjs',
    url: 'http://localhost:4184/pkm/',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
