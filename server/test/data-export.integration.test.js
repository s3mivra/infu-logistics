// One export endpoint per dataset, driven by lib/dataSets.js.
//
// The load-bearing property: the TEMPLATE is the export with no rows. They come
// from the same registry entry, so a template can never list columns the
// exporter does not produce or the importer does not accept - which is the
// usual way "download the template, fill it in, every row rejected" happens.
//
// The valid-values sheet exists for the same reason. Guessing a plausible
// label ("Rent", "Miscellaneous Expense") where a CODE was wanted is a real
// failure that costs someone an afternoon of typing.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;
const get = (p) => request(app).get(p).set('Authorization', `Bearer ${tok}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'ExportSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'ExportSuper');
}, 120000);

afterAll(async () => { await ctx.stop(); });

const M = (n) => mongoose.model(n);
beforeEach(async () => {
  for (const n of ['Inventory', 'Supplier', 'JournalEntry', 'Advance', 'CheckVoucher']) {
    await M(n).deleteMany({});
  }
});

describe('the catalogue of what can be exported', () => {
  it('lists every dataset with its columns', async () => {
    const res = await get('/api/export/datasets');
    expect(res.status).toBe(200);
    const keys = res.body.datasets.map(d => d.key);
    for (const k of ['inventory', 'products', 'clients', 'suppliers', 'bills',
      'purchaseOrders', 'advances', 'checkVouchers', 'revolvingFunds',
      'journal', 'stockCards', 'orders', 'expenses']) {
      expect(keys).toContain(k);
    }
    expect(res.body.datasets.every(d => Array.isArray(d.columns) && d.columns.length > 0)).toBe(true);
  });

  it('marks which datasets an import actually exists for', async () => {
    const byKey = Object.fromEntries((await get('/api/export/datasets')).body.datasets.map(d => [d.key, d]));
    expect(byKey.inventory.importable).toBe(true);
    // Posted ledger rows are export-only on purpose: importing them would let a
    // spreadsheet rewrite history.
    expect(byKey.journal.importable).toBe(false);
    expect(byKey.stockCards.importable).toBe(false);
    expect(byKey.orders.importable).toBe(false);
  });
});

describe('the template is the export with no rows', () => {
  it('returns the same columns whether or not data exists', async () => {
    await M('Inventory').create({ itemCode: 'RM-1', itemName: 'Beans', unit: 'g', stockQty: 100, unitCost: 1 });

    const withData = await get('/api/export/inventory');
    const template = await get('/api/export/inventory?template=1');

    // The property that stops template/export drift.
    expect(template.body.columns).toEqual(withData.body.columns);
    expect(template.body.rows).toHaveLength(0);
    expect(withData.body.rows).toHaveLength(1);
    expect(template.body.template).toBe(true);
  });

  it('exports the actual values, not just headers', async () => {
    await M('Inventory').create({
      itemCode: 'RM-9', itemName: 'Alaska Milk', unit: 'ml',
      stockQty: 2000, unitCost: 0.5, stockCategory: 'Dairy',
    });
    const [row] = (await get('/api/export/inventory')).body.rows;
    expect(row).toContain('RM-9');
    expect(row).toContain('Alaska Milk');
    // Total value is derived, not stored - worth exporting, easy to get wrong.
    expect(row).toContain(1000);
  });
});

describe('exporting the ledger', () => {
  it('gives one row per LINE, so it can be reconciled', async () => {
    await M('JournalEntry').create({
      date: new Date(), reference: 'JRN-1', description: 'Test sale',
      lines: [
        { accountCode: '111000', accountName: 'Cash on Hand', debit: 100, credit: 0 },
        { accountCode: '410000', accountName: 'Product Sales', debit: 0, credit: 100 },
      ],
      totalDebit: 100, totalCredit: 100,
    });
    const res = await get('/api/export/journal');
    // One entry, two lines, two rows.
    expect(res.body.rows).toHaveLength(2);
    expect(res.body.rows.map(r => r[3]).sort()).toEqual(['111000', '410000']);
  });

  it('filters by date range', async () => {
    const old = new Date(2020, 0, 15);
    await M('JournalEntry').insertMany([
      { date: new Date(), reference: 'NOW-1', lines: [{ accountCode: '111000', accountName: 'C', debit: 1, credit: 0 }, { accountCode: '410000', accountName: 'S', debit: 0, credit: 1 }], totalDebit: 1, totalCredit: 1 },
      { date: old, reference: 'OLD-1', lines: [{ accountCode: '111000', accountName: 'C', debit: 1, credit: 0 }, { accountCode: '410000', accountName: 'S', debit: 0, credit: 1 }], totalDebit: 1, totalCredit: 1 },
    ]);
    const today = new Date().toISOString().slice(0, 10);
    const res = await get(`/api/export/journal?start=${today}&end=${today}`);
    expect(res.body.rows.every(r => r[1] === 'NOW-1')).toBe(true);
  });

  it('reports truncation rather than pretending it is the whole set', async () => {
    await M('Inventory').insertMany(Array.from({ length: 10 }, (_, i) => ({
      itemCode: `T-${i}`, itemName: `Item ${i}`, unit: 'g', stockQty: 1, unitCost: 1,
    })));
    const res = await get('/api/export/inventory?limit=4');
    expect(res.body.rows).toHaveLength(4);
    expect(res.body.truncated).toBe(true);
  });
});

describe('the valid value table', () => {
  it('lists expense category CODES, which is what the importer wants', async () => {
    const res = await get('/api/export/valid-values');
    expect(res.status).toBe(200);
    const cat = res.body.table.find(t => t.dataset === 'expenses' && t.column === 'Category Code');
    expect(cat).toBeTruthy();
    // The exact trap this sheet exists to prevent.
    expect(cat.note).toMatch(/code/i);
    expect(cat.values.some(v => v.startsWith('630000'))).toBe(true);
    expect(cat.values.some(v => v.startsWith('760000'))).toBe(true);
  });

  it('includes accounts the old hardcoded list left out', async () => {
    const cat = (await get('/api/export/valid-values')).body.table
      .find(t => t.dataset === 'expenses' && t.column === 'Category Code');
    // Transportation & Delivery - a real account nothing could post to before.
    expect(cat.values.some(v => v.startsWith('670000'))).toBe(true);
  });

  it('lists live suppliers, not a static guess', async () => {
    await M('Supplier').create({ name: 'Metro Fuel' });
    const rows = (await get('/api/export/valid-values')).body.table;
    const sup = rows.find(t => t.column === 'Supplier');
    expect(sup.values).toContain('Metro Fuel');
  });

  it('lists the real status enumerations', async () => {
    const rows = (await get('/api/export/valid-values')).body.table;
    const bill = rows.find(t => t.dataset === 'bills' && t.column === 'Status');
    expect(bill.values).toContain('Partially Paid');
  });
});

describe('the account balance value table', () => {
  it('shows each account on the side it naturally carries', async () => {
    await M('JournalEntry').create({
      date: new Date(), reference: 'BAL-1', description: 'Sale',
      lines: [
        { accountCode: '111000', accountName: 'Cash on Hand', debit: 500, credit: 0 },
        { accountCode: '410000', accountName: 'Product Sales', debit: 0, credit: 500 },
      ],
      totalDebit: 500, totalCredit: 500,
    });

    const res = await get('/api/export/account-balances');
    expect(res.status).toBe(200);
    const cash = res.body.accounts.find(a => a.code === '111000');
    const sales = res.body.accounts.find(a => a.code === '410000');

    expect(cash.balance).toBe(500);
    expect(cash.side).toBe('Debit');
    // Revenue shown as +500 credit, not -500 - a negative here reads as an
    // error to anyone holding the printout.
    expect(sales.balance).toBe(500);
    expect(sales.side).toBe('Credit');
  });
});

describe('who may export', () => {
  it('refuses a cashier - exports carry costs and client terms', async () => {
    await makeUser({ name: 'ExportTill', role: 'cashier' });
    const cashierTok = await loginStaff(app, 'ExportTill');
    const res = await request(app).get('/api/export/inventory')
      .set('Authorization', `Bearer ${cashierTok}`);
    expect(res.status).toBe(403);
  });

  it('rejects an unknown dataset by name', async () => {
    const res = await get('/api/export/not-a-thing');
    expect(res.status).toBe(404);
  });
});
