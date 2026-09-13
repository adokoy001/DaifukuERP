import { defineConfig, devices } from '@playwright/test';
import normal from './playwright.config.ts';
const baseURL = 'http://localhost:5189';
if (process.env.E2E_IDENTITY_BASE_URL && process.env.E2E_IDENTITY_BASE_URL !== baseURL)
  throw new Error('Identity browser tests require the fixed local fixture origin.');
export default defineConfig({
  ...normal,
  outputDir: 'test-results/identity',
  testMatch: /enterprise-identity\.spec\.ts$/,
  use: { ...normal.use, baseURL },
  projects: [{ name: 'identity', use: { ...devices['Desktop Chrome'] } }],
});
