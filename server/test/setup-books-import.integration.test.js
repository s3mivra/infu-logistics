// Carrying a business's existing books in through the setup workbook: their
// own chart of accounts, this year's P&L month by month, the balance sheet on
// the switch-over day, and the invoices and bills still open on it.
//
// What has to be true afterwards: the balance sheet reads what theirs read, the
// monthly P&L reads what theirs read, the two tie out (nothing left over in
// Owner's Capital), and every open invoice and bill can be collected or paid -
// without Accounts Receivable, Payable or Inventory counting anything twice.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;
const M = (n) => mongoose.model(n);
const as = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const importRows = (what, rows, extra = {}) => as('post', `/api/setup/${what}/import`).send({ rows, ...extra });

// A small set of books, in the shape of a real one (their codes, their names).
const CHART = [
  { code: 'B-101501', name: 'Cash in bank_MBTC', goesUnder: '112000' },
  { code: 'B-120101', name: 'Account receivable - Trade', goesUnder: '120000' },            // forced onto the control account
  { code: 'B-120103', name: 'Due from affiliates', goesUnder: 'Non-Trade Receivables' },    // by name, under a heading
  { code: 'B-130101', name: 'Finished Goods Inventory', goesUnder: '130000', keepSeparate: 'No' },
  { code: 'B-150102', name: 'Office equipments', goesUnder: '140200' },
  { code: 'B-160102', name: 'Acc. Deprcn. - Office equipments', goesUnder: '150200' },
  { code: 'B-210101', name: 'Account payable - Trade', goesUnder: '220000', keepSeparate: 'No' },
  { code: 'B-310102', name: 'Net Income/(Loss)', goesUnder: '340000' },
  { code: 'B-310103', name: 'Retained Earnings', goesUnder: '330000', keepSeparate: 'No' },
  { code: 'B-410101', name: 'Gross Sales Revenue_Cash Sales', goesUnder: '410000', keepSeparate: 'No' },
  { code: 'B-410121', name: 'Sales discounts_Regular', goesUnder: '430000', keepSeparate: 'No' },
  { code: 'B-510101', name: 'Cost of Sales', goesUnder: '510000', keepSeparate: 'No' },
  { code: 'B-670113', name: 'Rental', goesUnder: '630000' },
  { code: 'B-810102', name: 'Misc. non-operating income', goesUnder: '830000' },
];
// Jan: 1,000 - 100 - 500 - 100 + 50 = 350.  Feb: 2,000 - 1,200 - 100 = 700.  Year: 1,050.
const PNL = [
  { code: 'B-410101', year: 2026, jan: '1,000', feb: 2000 },
  { code: 'B-410121', year: 2026, jan: 100, feb: '-' },
  { code: 'B-510101', year: 2026, jan: 500, feb: 1200 },
  { code: 'B-670113', year: 2026, Jan: 100, February: 100 },
  { code: 'B-810102', year: 2026, jan: 50 },
];
// Assets 5,000 + 1,500 + 2,000 + 800 + 1,200 - 200 = 10,300
// = AP 900 + net income 1,050 + retained earnings 8,350.
const BALANCES = [
  { code: 'B-101501', balance: '5,000', asOf: '2026-02-28' },
  { code: 'B-120101', balance: 1500 },
  { code: 'B-130101', balance: 2000 },
  { code: 'B-120103', balance: 800 },
  { code: 'B-150102', balance: 1200 },
  { code: 'B-160102', balance: '(200)' },
  { code: 'B-210101', balance: 900 },
  { code: 'B-310102', balance: 1050 },
  { code: 'B-310103', balance: '8,350' },
];

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'BooksOwner', role: 'superadmin' });
  tok = await loginStaff(app, 'BooksOwner');
  await M('ClientAccount').create({ clientCode: 'CUS-1000-A0700', username: 'reyes', password: 'x', name: 'Reyes Hardware' });
  await M('Supplier').create({ name: 'Metro Packaging' });
}, 120000);
afterAll(async () => { await ctx.stop(); });

describe('refusals leave nothing behind', () => {
  it('posts no month when one account is unknown', async () => {
    const res = await importRows('pnl-history', [...PNL, { code: 'B-999999', year: 2026, jan: 5 }]);
    expect(res.status).toBe(400);
    expect(res.body.problems.join('\n')).toMatch(/B-999999/);
    expect(await M('JournalEntry').countDocuments({ reference: /^PNLH-/ })).toBe(0);
  });
});

describe('carrying the books in', () => {
  it('adds their chart, keeping their codes', async () => {
    const res = await importRows('accounts', CHART);
    expect(res.body.success, JSON.stringify(res.body)).toBe(true);
    expect(res.body.skipped).toEqual([]);
    const bank = await M('Account').findOne({ externalCode: 'B-101501' }).lean();
    expect(bank).toMatchObject({ parent: '112000', name: 'Cash in bank_MBTC', isActive: false });   // not a till tender
    const rent = await M('Account').findOne({ externalCode: 'B-670113' }).lean();
    expect(rent).toMatchObject({ parent: '630000', isActive: true });
    // Trade receivables are the control account itself, even though keepSeparate was left blank.
    expect(await M('Account').exists({ externalCode: 'B-120101' })).toBeNull();
    expect(res.body.note).toMatch(/B-120101 → 120000/);
    // Importing the same sheet again changes nothing.
    const again = await importRows('accounts', CHART);
    expect(again.body.created).toBe(0);
  });

  it('posts the P&L month by month', async () => {
    const res = await importRows('pnl-history', PNL);
    expect(res.body.success, JSON.stringify(res.body)).toBe(true);
    expect(res.body.months.map(m => [m.month, m.netIncome])).toEqual([['2026-01', 350], ['2026-02', 700]]);
    expect(res.body.netIncome).toBe(1050);
    const monthly = await as('get', '/api/reports/pnl-monthly?start=2026-01-01&end=2026-02-28');
    const ni = monthly.body.monthTotals.netIncome;
    expect([ni['2026-01'], ni['2026-02']]).toEqual([350, 700]);
  });

  it('refuses the same P&L a second time', async () => {
    const res = await importRows('pnl-history', PNL);
    expect(res.status).toBe(409);
    expect(await M('JournalEntry').countDocuments({ reference: /^PNLH-/ })).toBe(2);
  });

  it('posts the balance sheet, leaving out the net income the P&L already made', async () => {
    const res = await importRows('opening-balances', BALANCES, { pnlHistory: true });
    expect(res.body.success, JSON.stringify(res.body)).toBe(true);
    expect(res.body.earningsOnBalanceSheet).toBe(1050);
    expect(res.body.balancingToCapital).toBe(1050);          // exactly the year's profit: the two statements agree

    const bs = (await as('get', '/api/reports/balance-sheet?asOf=2026-02-28')).body;
    expect(bs.totals).toMatchObject({ assets: 10300, liabilities: 900, balanced: true });
    const eq = Object.fromEntries(bs.equity.filter(e => !/computed/.test(e.name)).map(e => [e.code, e.amount]));
    expect(eq['330000']).toBe(8350);                          // their retained earnings
    expect(eq['310000'] || 0).toBe(0);                        // nothing left over in Owner's Capital
    expect(bs.equity.find(e => /computed/.test(e.name)).amount).toBe(1050);
    const inv = bs.assets.find(a => a.code === '130000');
    expect(inv.amount).toBe(2000);                            // on the control account, where stock moves post
  });

  it('refuses the balance sheet a second time', async () => {
    expect((await importRows('opening-balances', BALANCES, { pnlHistory: true })).status).toBe(409);
  });

  it('registers open invoices to collect, without counting them as sales or posting them again', async () => {
    const res = await importRows('open-receivables', [
      { customer: 'reyes hardware', invoiceNo: 'SI-1', invoiceDate: '2026-02-10', dueDate: '2026-03-12', amountOwed: '1,000' },
      { customer: 'Dela Cruz Store', invoiceNo: 'SI-2', invoiceDate: '2025-12-20', amountOwed: 500 },
      { customer: 'Nobody', invoiceNo: '', invoiceDate: '2026-02-01', amountOwed: 10 },
    ]);
    expect(res.body.created).toBe(2);
    expect(res.body.total).toBe(1500);
    expect(res.body.skipped[0].error).toMatch(/invoice number/);

    const ar = (await as('get', '/api/finance/ar-outstanding')).body;
    const si1 = ar.orders.find(o => o.orderNumber === 'SI-1');
    expect(si1).toMatchObject({ customerName: 'Reyes Hardware', balance: 1000 });
    expect(ar.totalOutstanding).toBe(1500);

    const sales = (await as('get', '/api/reports/sales-summary?start=2025-12-01&end=2026-02-28')).body;
    expect(JSON.stringify(sales)).not.toMatch(/SI-1|SI-2/);
    // Receivables in the register = Accounts Receivable in the books.
    const health = (await as('get', '/api/reports/books-health')).body;
    expect(health.checks.find(c => c.key === 'ar')).toMatchObject({ ok: true });
  });

  it('lets an opening invoice be collected like any other', async () => {
    const si1 = await M('Order').findOne({ orderNumber: 'SI-1' }).lean();
    const res = await as('post', `/api/orders/${si1._id}/settle-ar`).send({ amount: 400, paymentMethod: 'Cash on Hand', collectedBy: 'Owner', referenceNumber: 'OR-0001' });
    expect(res.body.success, JSON.stringify(res.body)).toBe(true);
    const ar = (await as('get', '/api/finance/ar-outstanding')).body;
    expect(ar.orders.find(o => o.orderNumber === 'SI-1').balance).toBe(600);
  });

  it('registers open bills, approved and payable, without posting them again', async () => {
    const res = await importRows('open-payables', [
      { supplier: 'Metro Packaging', invoiceNo: 'INV-9', invoiceDate: '2026-02-05', dueDate: '2026-03-07', amountOwed: 900 },
      { supplier: 'Unknown Co', invoiceNo: 'X', amountOwed: 5 },
    ]);
    expect(res.body.created).toBe(1);
    expect(res.body.skipped[0].error).toMatch(/No supplier/);
    const bill = await M('Bill').findOne({ supplierInvoiceNo: 'INV-9' }).lean();
    expect(bill).toMatchObject({ status: 'Approved', source: 'Opening', amount: 900 });
    const health = (await as('get', '/api/reports/books-health')).body;
    expect(health.checks.find(c => c.key === 'ap')).toMatchObject({ ok: true });
    // And the same bill is not taken twice.
    expect((await importRows('open-payables', [{ supplier: 'Metro Packaging', invoiceNo: 'INV-9', amountOwed: 900 }])).body.created).toBe(0);
  });

  it('registers stock and equipment alongside, posting nothing', async () => {
    const before = await M('JournalEntry').countDocuments({});
    const inv = await as('post', '/api/inventory/import').send({
      opening: true,
      items: [{ itemName: 'Carton box', itemCode: 'CB-1', unit: 'pcs', stockQty: 100, unitCost: 20, category: 'Packaging' }],
    });
    expect(inv.body.success, JSON.stringify(inv.body)).toBe(true);
    const fa = await as('post', '/api/fixed-assets/import').send({
      opening: true,
      rows: [{ name: 'Office printer', class: '140200', acquisitionCost: 1200, usefulLifeMonths: 36, acquisitionDate: '2025-06-01', accumulatedDepreciation: 200 }],
    });
    expect(fa.body.created ?? fa.body.success).toBeTruthy();
    expect(await M('FixedAsset').exists({ name: 'Office printer' })).toBeTruthy();
    expect(await M('JournalEntry').countDocuments({})).toBe(before);
  });
});
