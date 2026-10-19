import { test, expect } from '@playwright/test';
import { login } from './helpers.js';

// Every page of Ledger and of Reports, opened once.
//
// Most of these pages live in their own file and are handed what they need by
// LedgerTab; one name left out, or one report the server can no longer build,
// is a screen that crashes or sits empty the first time someone opens it. This
// opens each one and fails on three things: the page crashing, the "Something
// went wrong" screen, and any request the server answered with a 5xx.
const PAGES = {
  Ledger: {
    Books: ['General Ledger', 'Trial Balance', 'P&L', 'Balance Sheet'],
    'AR & AP': ['AR & AP', 'Bills (AP)'],
    'Cash Out': ['Revolving Funds', 'Expenses'],
    Setup: ['Accounts & Periods', 'Month-End Close', 'Backdate Sale', 'Tenancy Health', 'Books Health', 'Export All'],
  },
  Reports: {
    Sales: ['Sales', 'Sales by Channel', 'Sales by Customer', 'Sales Targets', 'By Payment', 'By Category', (process.env.VITE_BUSINESS_TYPE || 'fb') === 'log' ? 'Product Mix' : 'Menu Engineering'],
    Receivable: ['A/R Report', 'Collections'],
    Payable: ['A/P Report', 'Supplier Payments', 'Supplier Prices', 'Supplier Statement', 'Check Vouchers', 'Advances'],
    Financials: ['Monthly P&L', 'Monthly Balance Sheet', 'Cash Flow', 'Cash Forecast', 'Budget vs Actual', 'Percentage Tax', 'VAT Return'],
    Operations: ['Price Changes', 'Cashier Variance', 'Commissions', 'Exceptions', 'Waste Log', 'Sales by Hour', 'Cashier Performance', ...((process.env.VITE_BUSINESS_TYPE || 'fb') === 'log' ? ['Delivery Sheet'] : ['Prep List', 'Customer Feedback'])],
  },
};

for (const [tab, groups] of Object.entries(PAGES)) {
  test(`every ${tab} page opens without crashing or a server error`, async ({ page }) => {
    test.setTimeout(240000);
    const crashes = [];
    const serverErrors = [];
    let where = tab;
    page.on('pageerror', (e) => crashes.push(`${where}: ${String(e)}`));
    page.on('response', (r) => {
      if (r.status() >= 500 && r.url().includes('/api/')) serverErrors.push(`${where}: ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
    });

    await login(page);
    await page.getByRole('button', { name: tab, exact: true }).first().click();
    await expect(page.getByText('Loading…')).toHaveCount(0, { timeout: 20000 });

    const opened = [];
    const missing = [];
    for (const [group, labels] of Object.entries(groups)) {
      // .last(): the sidebar has a section called Operations too, and comes first.
      const groupBtn = page.getByRole('button', { name: group, exact: true }).last();
      // A group that this business does not show (an optional module switched
      // off) is recorded, not silently skipped - see the count at the end.
      if (!(await groupBtn.count())) { missing.push(...labels.map((l) => `${group} / ${l}`)); continue; }
      await groupBtn.click();
      for (const label of labels) {
        where = `${tab} / ${label}`;
        const btn = page.getByRole('button', { name: label, exact: true }).last();
        if (!(await btn.count())) { missing.push(`${group} / ${label}`); continue; }
        await btn.click();
        // Long enough for the page to draw and its first requests to answer.
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(250);
        await expect(page.getByText('Something went wrong'), `${where} crashed`).toHaveCount(0);
        opened.push(label);
      }
    }

    expect(crashes, crashes.join('\n')).toEqual([]);
    expect(serverErrors, serverErrors.join('\n')).toEqual([]);
    // Most pages must really have been opened, or this proved nothing.
    expect(opened.length, `opened: ${opened.join(', ')}\nnot shown: ${missing.join(', ')}`).toBeGreaterThanOrEqual(Math.ceil(Object.values(groups).flat().length * 0.7));
    console.log(`${tab}: opened ${opened.length}; not shown: ${missing.join(', ') || 'none'}`);
  });
}
