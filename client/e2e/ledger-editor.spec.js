import { test, expect } from '@playwright/test';
import { login, ADMIN, PASS } from './helpers.js';

// The superadmin corrects a posted entry from the General Ledger: the original
// stays (marked Changed), and a reversal and the correction are posted.
const API = process.env.VITE_API_URL || 'http://localhost:5002';

test('the superadmin corrects a ledger entry', async ({ page, request }) => {
  test.setTimeout(120000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const tok = (await (await request.post(`${API}/api/users/login`, { data: { name: ADMIN, password: PASS } })).json()).token;
  const memo = `EDITME ${Date.now()}`;
  const r = await (await request.post(`${API}/api/journal`, { headers: { Authorization: `Bearer ${tok}` },
    data: { description: memo, lines: [{ accountCode: '630000', debit: 1500 }, { accountCode: '111000', credit: 1500 }] } })).json();
  expect(r.success, JSON.stringify(r)).toBe(true);
  const ref = r.entry.reference;

  await login(page);
  await page.getByRole('button', { name: 'Ledger', exact: true }).first().click();
  await page.getByRole('button', { name: 'General Ledger', exact: true }).last().click();
  await page.getByPlaceholder(/Search by reference or description/).fill(memo);
  const card = page.locator('div.bg-page-bg').filter({ hasText: ref }).first();
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = page.getByLabel(`Edit ${ref}`);
  await editor.getByLabel('Line 1 debit').fill('1200');
  await editor.getByLabel('Line 2 credit').fill('1200');
  await editor.getByPlaceholder('e.g. wrong amount on the receipt').fill('Receipt said 1,200');
  await editor.getByRole('button', { name: 'Save correction' }).click();
  await expect(page.getByText('Entry corrected.')).toBeVisible({ timeout: 20000 });
  await expect(card.getByText('Changed')).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('Reason: Receipt said 1,200').first()).toBeVisible();
  expect(errors, errors.join('\n')).toHaveLength(0);
});
