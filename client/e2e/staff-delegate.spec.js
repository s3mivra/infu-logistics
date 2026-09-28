import { test, expect } from '@playwright/test';
import { ADMIN, PASS } from './helpers.js';

// "Manage staff & permissions" (users.manage) used to be a tick box that did
// nothing: every staff route and the only staff screen were superadmin-only.
// The server now honours it with escalation limits; this proves the SCREEN
// follows - a delegate gets into the Admin Panel, sees User Control and
// nothing else, and is not thrown out when the server refuses an action.
const API = process.env.VITE_API_URL || 'http://localhost:5002';

test('a staff delegate gets User Control only', async ({ page, request }) => {
  // Set up the delegate through the API as the owner.
  const login = await request.post(`${API}/api/users/login`, { data: { name: ADMIN, password: PASS } });
  const { token } = await login.json();
  const name = `Delegate${Date.now()}`;
  const created = await request.post(`${API}/api/users`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name, password: 'Deleg8te!pw', role: 'Staff',
      permissions: ['users.manage', 'pos.use', 'orders.view', 'inventory.view', 'products.view'],
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();

  await page.goto('/admin/admin-panel');
  await page.getByPlaceholder('Admin Name').fill(name);
  await page.getByPlaceholder('Password').fill('Deleg8te!pw');
  await page.keyboard.press('Enter');

  // In, and on the staff list.
  await expect(page.getByRole('button', { name: /User Control/ }).first()).toBeVisible({ timeout: 20000 });
  // None of the owner-only sections are offered.
  for (const section of ['Access Roles', 'Client Accounts', 'Price Tiers', 'Settings']) {
    await expect(page.getByRole('button', { name: new RegExp(`^${section}`) })).toHaveCount(0);
  }

  // A refused action shows the server's reason and does NOT log them out.
  await page.getByRole('button', { name: /add user|new user|create user/i }).first().click();
  await page.getByPlaceholder('e.g. Maria Santos').fill(`Shadow${Date.now()}`);
  const pw = page.locator('form input[type="password"]').last();
  await pw.fill('Shad0w!pw123');
  await page.locator('form select').filter({ has: page.locator('option[value="Admin"]') }).selectOption('Admin');
  await page.locator('form button[type="submit"]').last().click();
  await expect(page.getByText(/permissions you do not hold yourself/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /User Control/ }).first()).toBeVisible();
});
