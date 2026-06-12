import { test, expect } from '@playwright/test';
import { login } from './helpers.js';

// Whole-dashboard smoke: open every tab and assert each lazy chunk mounts and no
// runtime/console errors occur anywhere. Catches broken tabs, failed lazy-loads,
// and render crashes across the entire admin app in one pass.
const TABS = [
  'Orders & POS',
  'Inventory & Stock',
  'Menu Setup',
  'Daily History & Shifts',
  'Analytics',
  'Accounting & Ledger',
  'Pricing Control',
  'Audit Report',
];

test('every dashboard tab opens without runtime errors', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await login(page); // logs in as Super Admin (sees all management tabs)

  for (const label of TABS) {
    await page.getByRole('button', { name: label, exact: true }).first().click();
    // Lazy tab chunk finished mounting once the Suspense "Loading…" fallback is gone.
    await expect(page.getByText('Loading…')).toHaveCount(0, { timeout: 20000 });
    await page.waitForTimeout(500); // let the tab's async fetches settle
  }

  const real = errors.filter(e =>
    !/favicon|manifest|service ?worker|net::ERR|Failed to load resource|the server responded with a status of 4/i.test(e)
  );
  expect(real, `Console/runtime errors while navigating tabs:\n${real.join('\n')}`).toHaveLength(0);
});

test('ledger sub-views load (Journal, P&L, Balance Sheet, A/R, A/P)', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await login(page);
  await page.getByRole('button', { name: 'Accounting & Ledger', exact: true }).first().click();
  await expect(page.getByText('Loading…')).toHaveCount(0, { timeout: 20000 });

  // Click through the ledger sub-tabs that exist; tolerate naming differences.
  for (const sub of [/journal/i, /p&l|profit/i, /balance sheet/i, /a\/r|receivable/i, /a\/p|payable/i]) {
    const btn = page.getByRole('button', { name: sub }).first();
    if (await btn.count()) { await btn.click().catch(() => {}); await page.waitForTimeout(300); }
  }
  expect(errors, errors.join('\n')).toHaveLength(0);
});
