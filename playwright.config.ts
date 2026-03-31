import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  timeout: 30_000,

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: [
    {
      command: 'pnpm --filter @dblumi/api dev',
      port: 3000,
      reuseExistingServer: !process.env.CI,
      cwd: '.',
      timeout: 15_000,
    },
    {
      command: 'pnpm --filter @dblumi/web dev',
      port: 5173,
      reuseExistingServer: !process.env.CI,
      cwd: '.',
      timeout: 15_000,
    },
  ],
})
