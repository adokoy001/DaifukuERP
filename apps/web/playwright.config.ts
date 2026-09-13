import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// See CONTRIBUTING.md: start isolated API/Web servers after preparing the empty E2E database.
// Normally Playwright selects its matching Chromium revision, including PLAYWRIGHT_BROWSERS_PATH.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
if (executablePath && !existsSync(executablePath)) throw new Error('PLAYWRIGHT_CHROMIUM_EXECUTABLE does not exist');

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1, // The industry project prepares shared demo companies through the actual UI.
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [
    { name: 'industry', testMatch: /industry-templates\.spec\.ts$/, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'chromium',
      testIgnore: /(?:industry-templates|enterprise-identity)\.spec\.ts$/,
      dependencies: ['industry'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
