import { test, expect } from '@playwright/test';
import { login, ADMIN, PASS } from './helpers.js';

// Payroll worked out by the app: Compute fills SSS, PhilHealth, Pag-IBIG and
// tax from the rules; the rules and the payroll report open.
const API = process.env.VITE_API_URL || 'http://localhost:5002';

test('compute a payroll line, save it, open the rules and the report', async ({ page, request }) => {
  test.setTimeout(120000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const tok = (await (await request.post(`${API}/api/users/login`, { data: { name: ADMIN, password: PASS } })).json()).token;
  const on = await request.patch(`${API}/api/settings/payrollEnabled`, { headers: { Authorization: `Bearer ${tok}` }, data: { value: true } });
  expect(on.ok(), await on.text()).toBeTruthy();

  await login(page);
  await page.getByRole('button', { name: /^Payroll/ }).first().click();
  await page.getByRole('button', { name: /New run/i }).first().click();
  const dates = page.locator('input[type="date"]');
  await dates.nth(0).fill('2026-10-01');
  await dates.nth(1).fill('2026-10-15');
  await page.getByLabel('Employee').first().fill('Test Worker');
  const row = page.locator('tr').filter({ has: page.getByLabel('Employee') }).first();
  await row.locator('input[type="number"]').first().fill('15000');
  await page.getByRole('button', { name: /Compute SSS/ }).click();
  await expect(row.locator('input[type="number"]').nth(5)).toHaveValue('750');      // SSS
  await expect(row.locator('input[type="number"]').nth(6)).toHaveValue('375');      // PhilHealth
  await expect(row.locator('input[type="number"]').nth(7)).toHaveValue('100');      // Pag-IBIG
  await expect(row.locator('input[type="number"]').nth(8)).toHaveValue('503.7');    // tax
  await expect(row.getByText(/taxable ₱13,775\.00/)).toBeVisible();
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText(/Draft saved\. Nothing posts/)).toBeVisible({ timeout: 10000 });

  await page.getByRole('button', { name: /Tax & contribution rules/ }).click();
  const rules = page.getByRole('dialog', { name: 'Tax and contribution rules' });
  await expect(rules.getByText('Withholding tax table')).toBeVisible();
  await expect(rules.getByText(/₱16,667\.00 to ₱33,333\.00: ₱937\.50 \+ 20% over/)).toBeVisible();
  await rules.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: /Payroll report/ }).click();
  const rep = page.getByRole('dialog', { name: 'Payroll report' });
  await rep.getByRole('button', { name: 'Show' }).click();
  await expect(rep.getByText(/No approved or paid payroll|Total/).first()).toBeVisible({ timeout: 10000 });
  expect(errors, errors.join('\n')).toHaveLength(0);
});
