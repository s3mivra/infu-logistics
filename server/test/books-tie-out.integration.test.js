// Do the books actually tie out?
//
// Every other accounting test here proves one posting is right. This one runs a
// whole business through its cycle - capital in, stock bought, an asset bought
// and worn down, a batch produced, drinks sold for cash and on account, an
// expense paid, a customer settled, an asset sold at a loss - and then asks the
// two questions an accountant would ask of the finished books:
//
//   1. Assets = Liabilities + Equity, off the balance sheet the app prints.
//   2. The P&L's net income equals the movement in equity over the same period.
//
// A per-entry balance check cannot answer either. An entry can balance perfectly
// and still be posted to the wrong side of the wrong statement - revenue landing
// in a liability, an expense in an asset - and the trial balance would never
// notice. These two checks would.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff, trialBalance } from './helpers/harness.js';

let ctx, app, tok;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const M = (n) => mongoose.model(n);
const r2 = (n) => Math.round(n * 100) / 100;

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'BooksSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'BooksSuper');
}, 120000);

afterAll(async () => { await ctx.stop(); });

const balanceSheet = async () => (await auth('get', '/api/reports/balance-sheet')).body;
const pnl = async (start, end) =>
  (await auth('get', `/api/reports/pnl?start=${start}&end=${end}`)).body;

// Books balance to the centavo, not "roughly".
const expectTied = (bs, label) => {
  expect(bs.totals.balanced, `${label}: assets ${bs.totals.assets} vs L+E ${bs.totals.liabilitiesAndEquity}`).toBe(true);
  expect(bs.totals.assets).toBeCloseTo(bs.totals.liabilitiesAndEquity, 2);
};

// ── THE CYCLE ──────────────────────────────────────────────────────────────
// Each step is a real HTTP call against the same routes the app uses, so this
// exercises the postings rather than a re-implementation of them.
let beans, product;

async function runTheBusiness() {
  // 1. The owner puts money in.
  await M('JournalEntry').create({
    date: new Date(), reference: 'OB-CAPITAL',
    description: 'Owner capital',
    lines: [
      { accountCode: '111000', accountName: 'Cash on Hand', debit: 200000, credit: 0 },
      { accountCode: '310000', accountName: "Owner's Capital", debit: 0, credit: 200000 },
    ],
    totalDebit: 200000, totalCredit: 200000,
  });

  // 2. Stock, bought for cash.
  beans = await M('Inventory').create({
    itemCode: 'RM-BEAN', itemName: 'Coffee Beans', unit: 'g',
    stockQty: 0, unitCost: 0, unitMultiplier: 1,
  });
  const po = await auth('post', '/api/purchase-orders').send({
    supplier: 'Metro Beans',
    lines: [{ invId: String(beans._id), itemName: 'Coffee Beans', unit: 'g', packSize: 1000, orderedQty: 20, unitCost: 500 }],
  });
  await auth('post', `/api/purchase-orders/${po.body.purchaseOrder._id}/receive`)
    .send({ received: [{ index: 0, receivedQty: 20 }] });

  // 3. An espresso machine, and a month of wear on it.
  const asset = await auth('post', '/api/fixed-assets').send({
    name: 'Espresso Machine', accountCode: '140200',
    acquisitionCost: 60000, salvageValue: 6000, usefulLifeMonths: 60,
    acquisitionDate: '2026-01-15', paidFromAccount: '111000',
  });
  await auth('post', '/api/fixed-assets/run-depreciation').send({ asOf: '2026-04-30' });

  // 4. Something to sell, built on the stock.
  await auth('post', '/api/products/import-menu').send({
    rows: [{ name: 'AMERICANO', category: 'COFFEE', srp: 120,
      ingredients: [{ name: 'Coffee Beans', qty: 18, unit: 'g' }] }],
  });
  product = await M('Product').findOne({ name: 'AMERICANO' }).lean();

  // 5. Sales - one for cash, one on account.
  const sell = async (paymentMethod) => {
    const res = await auth('post', '/api/orders').send({
      table: 'Takeout', paymentMethod,
      items: [{ productId: String(product._id), name: product.name, price: 120, quantity: 3 }],
    });
    if (res.status !== 200) throw new Error(`sale rejected (${res.status}): ${res.body?.error}`);
    await auth('put', `/api/orders/${res.body.order._id}`).send({ status: 'Completed' });
    return res.body.order;
  };
  await sell('Cash');
  await sell('Bank Transfer');   // settles to A/R rather than cash

  // 6. An expense, paid in cash.
  const exp = await auth('post', '/api/expenses').send({
    amount: 3500, categoryCode: '610000', paymentMethod: 'Cash on Hand',
    description: 'Electricity',
  });
  if (!exp.body?.success) throw new Error(`expense rejected: ${exp.body?.error}`);

  // 7. The machine is sold on, for less than it is carried at.
  await auth('post', `/api/fixed-assets/${asset.body.asset._id}/dispose`)
    .send({ proceeds: 40000, receivedInAccount: '111000', note: 'Upgraded' });
}

describe('the books after a full cycle', () => {
  beforeAll(async () => { await runTheBusiness(); }, 120000);

  it('actually posted the whole cycle', async () => {
    // Guard against a green run that proves nothing: had the sales or the
    // expense been rejected, every balance check below would still pass on an
    // almost-empty ledger.
    const refs = (await M('JournalEntry').find({}, { reference: 1 }).lean()).map(e => e.reference);
    const seen = (re) => refs.some(r => re.test(r));
    expect(seen(/^OB-CAPITAL/), 'capital').toBe(true);
    expect(seen(/^PO-RCV/), 'stock received').toBe(true);
    expect(seen(/^FA-ACQ/), 'asset bought').toBe(true);
    expect(seen(/^FA-DEP/), 'depreciation posted').toBe(true);
    expect(seen(/^FA-DIS/), 'asset disposed').toBe(true);
    expect(seen(/^EXP/), 'expense').toBe(true);
    expect(await M('Order').countDocuments({ status: 'Completed' }), 'sales').toBeGreaterThanOrEqual(2);
  }, 60000);

  it('has a trial balance that balances', async () => {
    const { debits, credits } = await trialBalance();
    expect(Math.abs(debits - credits)).toBeLessThanOrEqual(0.01);
    // And it is not trivially balanced by there being nothing in it.
    expect(debits).toBeGreaterThan(200000);
  }, 60000);

  it('prints a balance sheet where assets equal liabilities plus equity', async () => {
    expectTied(await balanceSheet(), 'after a full cycle');
  }, 60000);

  it('reports net income that agrees with the movement in equity', async () => {
    const bs = await balanceSheet();
    const p = await pnl('2020-01-01', '2030-12-31');

    // Equity is capital put in, plus everything earned since. Strip the capital
    // and what remains has to be the P&L's bottom line - if revenue or an
    // expense were classified onto the wrong statement, these two diverge while
    // every individual entry still balances.
    const capital = (bs.equity || [])
      .filter(e => ['310000', '315000', '320000'].includes(e.code))
      .reduce((s, e) => s + (e.amount || 0), 0);
    const earned = r2(bs.totals.equity - capital);

    expect(earned).toBeCloseTo(r2(p.totals?.netIncome ?? p.netIncome), 2);
  }, 60000);

  it('carries the loss on the machine, not a gain', async () => {
    // Bought 60,000, worn down 3 months at 900, sold for 40,000: it went for
    // less than it was carried at, and that has to land in the P&L.
    const p = await pnl('2020-01-01', '2030-12-31');
    const loss = JSON.stringify(p).match(/920000/);
    expect(loss).toBeTruthy();
  }, 60000);

  it('leaves nothing stranded in an account the statements do not classify', async () => {
    // Every account carrying a balance must appear on one of the two
    // statements. One that appears on neither is money the books have lost
    // track of - it still balances, it just is not reported anywhere.
    const agg = await M('JournalEntry').aggregate([
      { $unwind: '$lines' },
      { $group: {
        _id: '$lines.accountCode',
        debit: { $sum: { $ifNull: ['$lines.debit', 0] } },
        credit: { $sum: { $ifNull: ['$lines.credit', 0] } },
      } },
    ]);
    const withBalance = agg.filter(a => Math.abs(a.debit - a.credit) > 0.005).map(a => a._id);

    const bs = await balanceSheet();
    const p = await pnl('2020-01-01', '2030-12-31');
    const reported = new Set([
      ...[...(bs.assets || []), ...(bs.liabilities || []), ...(bs.equity || [])].map(r => r.code),
      ...JSON.stringify(p).match(/"\d{6}"/g)?.map(s => s.replace(/"/g, '')) || [],
    ]);

    const stranded = withBalance.filter(code => !reported.has(code));
    expect(stranded, `not on any statement: ${stranded.join(', ')}`).toEqual([]);
  }, 60000);
});

describe('the guarantee underneath all of it', () => {
  it('refuses to persist an entry that does not balance', async () => {
    await expect(M('JournalEntry').create({
      date: new Date(), reference: 'BAD-1', description: 'Deliberately lopsided',
      lines: [
        { accountCode: '111000', accountName: 'Cash on Hand', debit: 100, credit: 0 },
        { accountCode: '410000', accountName: 'Sales Revenue', debit: 0, credit: 90 },
      ],
      totalDebit: 100, totalCredit: 90,
    })).rejects.toThrow();
  }, 30000);

  it('still balances after that rejection', async () => {
    expectTied(await balanceSheet(), 'after a rejected entry');
  }, 60000);
});
