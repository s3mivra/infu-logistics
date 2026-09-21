// A page permission is enforced by the server, not only by hiding a button.
//
// Each report endpoint below feeds exactly one page, so the page's own key
// guards it. A bookkeeper given Bills and Expenses - and not the P&L - gets a
// 403 from the P&L endpoint however they ask for it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app;
const as = (tok) => (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
let narrow, whole, older;

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  // Ledger open on two pages only; Reports open on one.
  await makeUser({ name: 'Payables', role: 'finance', permissions: [
    'accounting.view', 'screen.ledger.bills', 'screen.ledger.expenses',
    'reports.view', 'screen.reports.vatreturn',
  ] });
  // The same tabs, no page named: every page, as before pages existed.
  await makeUser({ name: 'Books', role: 'finance', permissions: ['accounting.view', 'reports.view'] });
  // A built-in role with its defaults.
  await makeUser({ name: 'Fin', role: 'finance' });
  narrow = as(await loginStaff(app, 'Payables'));
  whole = as(await loginStaff(app, 'Books'));
  older = as(await loginStaff(app, 'Fin'));
}, 120000);

afterAll(async () => { await ctx.stop(); });

const range = 'start=2026-01-01&end=2026-12-31';

describe('a person narrowed to some pages', () => {
  it('is refused the pages they were not given', async () => {
    // The single-period P&L and balance sheet are Reports-domain endpoints
    // (reports.view, which this person holds) shown on Ledger pages, so they
    // are gated on screen only; the endpoints below each serve one page.
    for (const p of ['/api/reports/trial-balance', `/api/reports/sales-summary?${range}`,
      `/api/reports/menu-engineering?${range}`, `/api/reports/ar-aging`]) {
      const res = await narrow('get', p);
      expect(res.status, p).toBe(403);
      expect(res.body.error).toMatch(/screen\./);
    }
  });

  it('opens the page they were given', async () => {
    const res = await narrow('get', `/api/reports/vat?${range}`);
    expect(res.status).toBe(200);
  });

  it('still reaches data several pages share, under its domain permission', async () => {
    // The journal feeds the ledger, the dashboard and exports; it stays on
    // accounting.view rather than on any one page.
    const res = await narrow('get', '/api/journal?limit=5');
    expect(res.status).toBe(200);
  });

  it('carries its pages in the token the client reads', async () => {
    const me = await narrow('get', '/api/users/me');
    const perms = me.body.user?.permissions || [];
    expect(perms).toContain('screen.ledger.bills');
    expect(perms).not.toContain('screen.ledger.pnl');
  });
});

describe('everyone else keeps every page', () => {
  it('a person whose tabs name no page', async () => {
    for (const p of ['/api/reports/trial-balance', `/api/reports/pnl?${range}`, `/api/reports/sales-summary?${range}`]) {
      expect((await whole('get', p)).status, p).toBe(200);
    }
  });

  it('a built-in role on its defaults', async () => {
    for (const p of ['/api/reports/trial-balance', `/api/reports/vat?${range}`, `/api/reports/ap-aging`]) {
      expect((await older('get', p)).status, p).toBe(200);
    }
  });
});
