import { expect } from '@playwright/test';

export const ADMIN = process.env.E2E_ADMIN_NAME || 'Super Admin';
export const PASS  = process.env.E2E_ADMIN_PASS || 'ChangeMe@2026!';

// The login form is gone once authenticated → use that as the "logged in" signal.
export const loginField = (page) => page.getByLabel('Password', { exact: true });

// Logs in and FAILS FAST with the real reason if the app rejects the login,
// instead of silently waiting out the timeout.
export async function login(page) {
  await page.goto('/admin');
  await expect(page.getByText(/restoring session/i)).toHaveCount(0, { timeout: 30000 });
  await page.getByLabel('Staff Name').fill(ADMIN);
  await loginField(page).fill(PASS);
  await page.locator('form button[type="submit"]').click();

  const errorBox = page.getByText(/invalid name or password|network error|starting cash/i);

  const outcome = await Promise.race([
    loginField(page).waitFor({ state: 'hidden', timeout: 30000 }).then(() => 'ok').catch(() => 'timeout'),
    errorBox.first().waitFor({ state: 'visible', timeout: 30000 }).then(() => 'error').catch(() => 'timeout'),
  ]);

  if (outcome === 'error') {
    const msg = (await errorBox.first().textContent())?.trim();
    throw new Error(
      `Login rejected by the app: "${msg}".\n` +
      `→ If "Invalid name or password": set E2E_ADMIN_PASS (and E2E_ADMIN_NAME) to your seeded Super Admin.\n` +
      `→ If "Network error": the backend (server/) isn't reachable at the API URL.`
    );
  }
  if (outcome === 'timeout') {
    throw new Error(
      'Login neither succeeded nor showed an error within 30s.\n' +
      '→ Most likely the BACKEND is not running, or VITE_API_URL points at the wrong server.'
    );
  }
}
