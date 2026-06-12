import { test, expect } from '@playwright/test';
import { login, loginField } from './helpers.js';

// Auth-flow E2E — verifies the dual-token system end to end.
// Requires the backend running against a TEST db with a seeded Super Admin whose
// password matches E2E_ADMIN_PASS (defaults to the dev seed password).

test.describe('Dual-token authentication', () => {
  test('logs in and reaches the dashboard', async ({ page }) => {
    await login(page);
  });

  test('access token is NOT persisted to localStorage', async ({ page }) => {
    await login(page);
    const leaked = await page.evaluate(() => localStorage.getItem('semivra_token') || localStorage.getItem('kasa_token'));
    expect(leaked).toBeNull();
  });

  test('session survives a single reload (silent refresh)', async ({ page }) => {
    await login(page);
    await page.reload();
    await expect(page.getByText(/restoring session/i)).toHaveCount(0, { timeout: 30000 });
    await expect(loginField(page)).toHaveCount(0);
  });

  test('spamming reload does NOT log the user out', async ({ page }) => {
    await login(page);
    for (let i = 0; i < 6; i++) await page.reload();
    await expect(page.getByText(/restoring session/i)).toHaveCount(0, { timeout: 30000 });
    await expect(loginField(page)).toHaveCount(0); // still authenticated
  });

  test('clearing the refresh cookie forces re-login', async ({ page }) => {
    await login(page);
    await page.context().clearCookies();
    await page.reload();
    await expect(loginField(page)).toBeVisible({ timeout: 30000 });
  });
});
