import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  webServer: undefined,
  projects: [{ name: 'unit', testMatch: ['**/unit/**/*.spec.ts', '**/integration/schema.spec.ts', '**/integration/library-repository.spec.ts', '**/integration/backup-repository.spec.ts'] }],
});
