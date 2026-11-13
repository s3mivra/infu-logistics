// Purchases imported from a sheet: date, reference, product code, qty, amount
// paid. Switches for stock and money; backdating and posting money need their
// own permissions; the same sheet pulled twice does not double anything.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';
import { businessDateStr } from '../lib/businessTime.js';

let ctx, app, ownerTok, stockTok, backdateTok, item;
const M = (n) => mongoose.model(n);
const imp = (tok, body) => request(app).post('/api/purchases/import').set('Authorization', `Bearer ${tok}`).send(body);
const today = () => businessDateStr();
const daysAgo = (n) => businessDateStr(new Date(Date.now() - n * 86400000));
const row = (extra = {}) => ({ date: today(), reference: 'OR-1001', itemCode: 'RICE-25', qty: 10, amountPaid: 12000, supplier: 'Mill Co', ...extra });

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'PiOwner', role: 'superadmin' });
  await makeUser({ name: 'PiStock', role: 'staff', permissions: ['inventory.view', 'inventory.manage'] });
  await makeUser({ name: 'PiBackdate', role: 'staff', permissions: ['inventory.view', 'inventory.manage', 'sales.backdate'] });
  ownerTok = await loginStaff(app, 'PiOwner');
  stockTok = await loginStaff(app, 'PiStock');
  backdateTok = await loginStaff(app, 'PiBackdate');
  item = await M('Inventory').create({ itemName: 'Rice 25kg', itemCode: 'RICE-25', unit: 'pcs', stockQty: 5, unitCost: 1000, businessType: 'log' });
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('preview', () => {
  it('reads and checks every row, writes nothing', async () => {
    const res = await imp(ownerTok, { preview: true, affectStock: true, affectMoney: true, rows: [
      row(), row({ itemCode: 'NOPE' }), row({ qty: 0, reference: 'X' }), row({ date: '2099-01-01', reference: 'Y' }), {},
    ] });
    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({ rows: 4, ready: 1, errors: 3, totalPaid: 12000 });
    expect(res.body.lines[1].error).toMatch(/No stock item with code "NOPE"/);
    expect(res.body.lines[2].error).toMatch(/quantity/);
    expect(res.body.lines[3].error).toMatch(/future/);
    expect((await M('Inventory').findById(item._id).lean()).stockQty).toBe(5);
  });
});

describe('stock and money both on', () => {
  it('adds stock at the new average cost and books the purchase on its date', async () => {
    const res = await imp(ownerTok, { affectStock: true, affectMoney: true, paidFrom: 'Bank', rows: [row()] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.imported).toBe(1);
    const after = await M('Inventory').findById(item._id).lean();
    expect(after.stockQty).toBe(15);
    expect(after.unitCost).toBeCloseTo((5 * 1000 + 12000) / 15, 6);
    const card = await M('StockCard').findOne({ inventoryId: item._id, type: 'Restock' }).sort({ _id: -1 }).lean();
    expect(card.remarks).toMatch(/OR-1001 from Mill Co/);
    const je = await M('JournalEntry').findOne({ reference: card.reference }).lean();
    expect(je.lines.map((l) => [l.accountCode, l.debit, l.credit])).toEqual([['130000', 12000, 0], ['112000', 0, 12000]]);
  });

  it('pulling the same sheet again changes nothing', async () => {
    const res = await imp(ownerTok, { affectStock: true, affectMoney: true, paidFrom: 'Bank', rows: [row()] });
    expect(res.body.imported).toBe(0);
    expect(res.body.skipped[0].note).toMatch(/Already imported/);
    expect((await M('Inventory').findById(item._id).lean()).stockQty).toBe(15);
  });
});

describe('the switches', () => {
  it('stock only: stock moves, nothing is posted', async () => {
    const before = await M('JournalEntry').countDocuments();
    const res = await imp(ownerTok, { affectStock: true, affectMoney: false, rows: [row({ reference: 'OR-2002', qty: 2, amountPaid: 2400 })] });
    expect(res.body.imported).toBe(1);
    expect((await M('Inventory').findById(item._id).lean()).stockQty).toBe(17);
    expect(await M('JournalEntry').countDocuments()).toBe(before);
  });

  it('neither: only recorded', async () => {
    const res = await imp(ownerTok, { affectStock: false, affectMoney: false, rows: [row({ reference: 'OR-3003', qty: 4, amountPaid: 4800 })] });
    expect(res.body.imported).toBe(1);
    expect((await M('Inventory').findById(item._id).lean()).stockQty).toBe(17);
    const list = await request(app).get('/api/purchases').set('Authorization', `Bearer ${ownerTok}`);
    const rec = list.body.purchases.find((p) => p.reference === 'OR-3003');
    expect(rec).toMatchObject({ itemCode: 'RICE-25', qty: 4, amountPaid: 4800, affectsStock: false, affectsMoney: false });
  });
});

describe('permissions', () => {
  it('a past date needs the backdate permission', async () => {
    const refused = await imp(stockTok, { affectStock: true, rows: [row({ date: daysAgo(10), reference: 'OLD-1' })] });
    expect(refused.body.imported).toBe(0);
    expect(refused.body.skipped[0].error).toMatch(/backdate/);
    const allowed = await imp(backdateTok, { affectStock: true, rows: [row({ date: daysAgo(10), reference: 'OLD-1' })] });
    expect(allowed.body.imported).toBe(1);
    const card = await M('StockCard').findOne({ remarks: /OLD-1/ }).lean();
    expect(businessDateStr(card.date)).toBe(daysAgo(10));
  });

  it('posting money needs accounting or fund rights', async () => {
    const res = await imp(stockTok, { affectStock: true, affectMoney: true, rows: [row({ reference: 'M-1' })] });
    expect(res.status).toBe(403);
  });

  it('importing at all needs inventory.manage', async () => {
    await makeUser({ name: 'PiCashier', role: 'staff', permissions: ['pos.use'] });
    const tok = await loginStaff(app, 'PiCashier');
    expect((await imp(tok, { rows: [row()] })).status).toBe(403);
  });
});

describe('the purchases sheet link', () => {
  it('is open to whoever may receive stock, not only the owner', async () => {
    const res = await request(app).get('/api/purchases-sheet').set('Authorization', `Bearer ${stockTok}`);
    expect(res.status).toBe(200);
    const cashier = await loginStaff(app, 'PiCashier');
    expect((await request(app).get('/api/purchases-sheet').set('Authorization', `Bearer ${cashier}`)).status).toBe(403);
  });

  it('the past-sales sheet is only for whoever may backdate', async () => {
    expect((await request(app).get('/api/sales-sheet').set('Authorization', `Bearer ${backdateTok}`)).status).toBe(200);
    expect((await request(app).get('/api/sales-sheet').set('Authorization', `Bearer ${stockTok}`)).status).toBe(403);
  });
});
