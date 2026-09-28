import { test, expect } from '@playwright/test';
import { ADMIN, PASS, loginField } from './helpers.js';

// Menu Setup opens with products.view and Inventory with inventory.view, but
// changing either needs products.manage / inventory.manage - the server
// refuses otherwise. A view-only user used to be handed the full forms anyway,
// every save failing. The screens now follow the same line as the server.
const API = process.env.VITE_API_URL || 'http://localhost:5002';

test('a view-only staff member sees the menu and stock, not the controls to change them', async ({ page, request }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  const tok = (await (await request.post(`${API}/api/users/login`, { data: { name: ADMIN, password: PASS } })).json()).token;
  const name = `Viewer${Date.now()}`;
  const made = await request.post(`${API}/api/users`, {
    headers: { Authorization: `Bearer ${tok}` },
    data: { name, password: 'Viewer123!', role: 'Staff', permissions: ['pos.use', 'orders.view', 'inventory.view', 'products.view'] },
  });
  expect(made.ok(), await made.text()).toBeTruthy();

  await page.goto('/admin');
  await expect(page.getByText(/restoring session/i)).toHaveCount(0, { timeout: 30000 });
  await page.getByLabel('Staff Name').fill(name);
  await loginField(page).fill('Viewer123!');
  const cash = page.getByPlaceholder('Starting Cash');
  if (await cash.count()) await cash.fill('0');
  await page.locator('form button[type="submit"]').click();
  await expect(loginField(page)).toBeHidden({ timeout: 30000 });
  // Staff clock in before using the system.
  const clockIn = page.getByRole('button', { name: /Clock in/i });
  if (await clockIn.count()) await clockIn.first().click();
  // A first sign-in opens the quick guide over the screen; close it.
  const closeGuide = page.getByRole('button', { name: 'Close guide' });
  await closeGuide.waitFor({ timeout: 10000 }).then(() => closeGuide.click()).catch(() => {});

  // Menu Setup: the list and a note, no product form or management blocks.
  await page.getByRole('button', { name: /^(Menu|Catalog) Setup/ }).first().click();
  await expect(page.getByText(/View only\. Changing the menu needs/)).toBeVisible();
  await expect(page.getByRole('heading', { name: /^(Add|Edit) Product$/ })).toHaveCount(0);
  await expect(page.getByText(/Manage Categories/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Read Workbook/i })).toHaveCount(0);

  // Inventory: stock is visible, receiving and importing are not.
  await page.getByRole('button', { name: /^Inventory & Stock/ }).first().click();
  await expect(page.getByText('Receive Inventory')).toHaveCount(0);
  await expect(page.getByText(/^Import$/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /EOD Audit/ })).toHaveCount(0);

  expect(errors, errors.join('\n')).toEqual([]);
});
