import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 15_000 },
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:4183',
    headless: true,
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'unit', testMatch: ['**/unit/**/*.spec.ts', '**/integration/schema.spec.ts', '**/integration/library-repository.spec.ts', '**/integration/backup-repository.spec.ts'] },
    { name: 'chrome', testIgnore: ['**/unit/**', '**/hosting/**', '**/integration/schema.spec.ts', '**/integration/library-repository.spec.ts', '**/integration/backup-repository.spec.ts'], use: { channel: 'chrome', browserName: 'chromium' } },
    { name: 'edge', testIgnore: ['**/unit/**', '**/hosting/**', '**/integration/schema.spec.ts', '**/integration/library-repository.spec.ts', '**/integration/backup-repository.spec.ts'], use: { channel: 'msedge', browserName: 'chromium' } },
  ],
  webServer: {
    command: 'node scripts/preview-tests.mjs',
    url: 'http://localhost:4183',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
