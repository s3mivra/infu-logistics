import { defineConfig, devices } from '@playwright/test';

// E2E config for the Semivra POS frontend.
//
// Prereqs to run:
//   1. Backend running (server/) against a TEST MongoDB (never production), with a
//      seeded Super Admin whose password = E2E_ADMIN_PASS.
//      Easiest: `npm run e2e:server` at the repo root — boots the API on an
//      in-memory MongoDB with the default seed password (ChangeMe@2026!).
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
    // The counter device: Samsung Galaxy Tab A11+ (11", 1920x1200 panel at
    // 1.5x = 1280x800 CSS px), landscape, touch. Runs the checks that depend
    // on layout - the flows themselves are covered once, on desktop.
    {
      name: 'tab-a11plus',
      testMatch: /(smoke|navigation|contrast)\.spec\.js$/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true },
    },
    // A staff phone (clock-in, stock count, the client portal on the go).
    // navigation.spec clicks the desktop sidebar, which a phone keeps
    // off-canvas behind the menu button - so the phone runs sign-in and smoke.
    { name: 'phone', testMatch: /(smoke|auth)\.spec\.js$/, use: { ...devices['Pixel 7'] } },
  ],
});
