import { test, expect } from '@playwright/test';
import { login, ADMIN, PASS } from './helpers.js';

// Typing the start of an existing client's name and pressing Tab fills the
// name and picks that client; the order type starts on Walk In.
const API = process.env.VITE_API_URL || 'http://localhost:5002';

test('Tab fills an existing client on the till; order type starts on Walk In', async ({ page, request }) => {
  const tok = (await (await request.post(`${API}/api/users/login`, { data: { name: ADMIN, password: PASS } })).json()).token;
  const name = `Autofill Cafe ${Date.now()}`;
  const made = await request.post(`${API}/api/client-accounts`, { headers: { Authorization: `Bearer ${tok}` }, data: { name } });
  expect(made.ok(), await made.text()).toBeTruthy();

  await login(page);
  await page.getByRole('button', { name: /^Orders & POS/ }).first().click();
  await page.getByRole('button', { name: /Manual Order/i }).first().click();
  await expect(page.getByText('Walk In', { exact: true }).first()).toBeVisible();
  const who = page.getByLabel('Customer name');
  await who.fill(name.slice(0, 12));
  await who.press('Tab');
  await expect(who).toHaveValue(name);
  await expect(page.getByText(new RegExp(`${name} \(`)).first()).toBeVisible();
});
