import { defineConfig, devices } from '@playwright/test';

export const E2E_PORT = Number(process.env.E2E_PORT ?? 3011);

export default defineConfig({
  testDir: 'e2e',
  // One app + one Redis are shared; keep specs serial so their state doesn't interleave.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    httpCredentials: { username: 'e2e-admin', password: 'e2e-admin-pw' },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
