import { defineConfig, devices } from '@playwright/test';

// E2E config for the Semivra POS frontend.
//
// Prereqs to run:
//   1. Backend running (server/) against a TEST MongoDB (never production), with a
//      seeded Super Admin whose password = E2E_ADMIN_PASS.
//   2. `npx playwright install chromium` once (or `npm run e2e:install`).
//
// The frontend dev server is started automatically below (reused if already up).
// Run:  npm run e2e          (set E2E_ADMIN_PASS if not the dev default)
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,             // headroom for the cold first compile/login
  fullyParallel: false,        // POS flows mutate shared server state — keep serial
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  // Auto-start the Vite dev server for the tests (reused if you already have it running).
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Add a tablet pass later if wanted:
    // { name: 'tablet', use: { ...devices['iPad (gen 7) landscape'] } },
  ],
});
