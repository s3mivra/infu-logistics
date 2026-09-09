import { test, expect } from '@playwright/test';
import { login } from './helpers.js';

// Whole-dashboard smoke: open every tab and assert each lazy chunk mounts and no
// runtime/console errors occur anywhere. Catches broken tabs, failed lazy-loads,
// and render crashes across the entire admin app in one pass.
const TABS = [
  'Orders & POS',
  'Inventory & Stock',
  'Procurement',
  'Clients',
  'Menu Setup',
  'Analytics',
  'Reports',
  'Ledger',
  'Pricing Control',
  'Shifts & Cash',
  'Audit Report',
  'Fixed Assets',
  'Production',
  'Quotations',
  // The optional accounting modules (Bank Reconciliation, Withholding Tax,
  // Payroll) only appear where they are switched on, so they are not in this
  // sweep - a tab that is deliberately absent is not a failure. They are
  // covered by their own switch-on test below.
];

test('every dashboard tab opens without runtime errors', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await login(page); // logs in as Super Admin (sees all management tabs)

  for (const label of TABS) {
    // Anchored regex rather than `exact: true`: some nav buttons carry a live
    // alert badge (e.g. "Inventory & Stock 2"), so their accessible name depends
    // on current stock. Matching the start of the label keeps this test about
    // navigation instead of about how much stock happens to be low.
    const name = new RegExp('^' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    await page.getByRole('button', { name }).first().click();
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
  await page.getByRole('button', { name: 'Ledger', exact: true }).first().click();
  await expect(page.getByText('Loading…')).toHaveCount(0, { timeout: 20000 });

  // Click through the ledger sub-tabs that exist; tolerate naming differences.
  for (const sub of [/journal/i, /p&l|profit/i, /balance sheet/i, /a\/r|receivable/i, /a\/p|payable/i]) {
    const btn = page.getByRole('button', { name: sub }).first();
    if (await btn.count()) { await btn.click().catch(() => {}); await page.waitForTimeout(300); }
  }
  expect(errors, errors.join('\n')).toHaveLength(0);
});

// The optional accounting modules are hidden until a business switches them
// on, which means the whole-app sweep above can never reach them - and they
// are the newest screens, so they are exactly the ones worth opening.
//
// This drives the real toggles in Settings rather than poking the API, so the
// switch is exercised too, and it ASSERTS each tab appears rather than
// skipping when it does not. A test that quietly skips its own subject passes
// forever while covering nothing.
test('the optional accounting modules open once they are switched on', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await login(page);

  await page.getByRole('button', { name: /^Settings/ }).first().click();
  await expect(page.getByText('Loading…')).toHaveCount(0, { timeout: 20000 });

  // The card only renders for a superadmin, which is who we are logged in as.
  // Scoped to the card on purpose: the Settings page carries other switches
  // above this one (QR orders, auto-close, images), and an unscoped
  // getByRole('switch') picks those up instead - which is exactly what an
  // earlier version of this test did, turning on the wrong three things and
  // then passing because it skipped when the tabs failed to appear.
  const heading = page.getByText('Accounting modules', { exact: true }).first();
  await expect(heading).toBeVisible({ timeout: 20000 });
  const card = heading.locator('xpath=following-sibling::div[1]');

  // A whole e2e run makes enough requests to trip the server's rate limiter,
  // and a rate-limited module list leaves the card showing its retry row
  // rather than the switches. Retrying here keeps the test about the screens
  // rather than about how fast the suite happens to run.
  for (let attempt = 0; attempt < 5; attempt++) {
    const retry = card.getByRole('button', { name: /^Retry$/ });
    if (await retry.count() === 0) break;
    await page.waitForTimeout(1500);
    await retry.click();
    await page.waitForTimeout(500);
  }

  for (const label of ['Bank Reconciliation', 'Withholding Tax', 'Payroll']) {
    // The label sits in its own <p>; the div around it also carries the blurb,
    // so an exact-text match has to target the text node, not the container.
    await expect(
      card.getByText(label, { exact: true }).first(),
      `${label} is not on the Accounting modules card`,
    ).toBeVisible({ timeout: 10000 });
    const toggle = card.getByRole('switch').nth(
      ['Bank Reconciliation', 'Withholding Tax', 'Payroll'].indexOf(label)
    );
    if (await toggle.getAttribute('aria-checked') === 'false') await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true', { timeout: 10000 });
  }

  await page.reload();
  await expect(page.getByText('Loading…')).toHaveCount(0, { timeout: 20000 });

  for (const label of ['Bank Reconciliation', 'Withholding Tax', 'Payroll']) {
    const button = page.getByRole('button', { name: new RegExp('^' + label) }).first();
    await expect(button, `${label} did not appear after switching it on`).toBeVisible({ timeout: 20000 });
    await button.click();
    await expect(page.getByText('Loading…')).toHaveCount(0, { timeout: 20000 });
    await page.waitForTimeout(500);
  }

  const real = errors.filter(e =>
    !/favicon|manifest|service ?worker|net::ERR|Failed to load resource|the server responded with a status of 4/i.test(e)
  );
  expect(real, `Console/runtime errors on the optional modules:\n${real.join('\n')}`).toHaveLength(0);
});
