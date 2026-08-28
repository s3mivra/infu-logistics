// Backdated sales - record historical sales for a past date. Itemized (like a
// normal order) with an optional inventory-reduction toggle (default OFF), plus
// the legacy lump-sum form. Every path must post a balanced entry dated to the
// chosen day and leave the books balanced.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff, trialBalance } from './helpers/harness.js';

let ctx, app, superTok, staffTok, prod, inv;
const auth = (m, p, t) => request(app)[m](p).set('Authorization', `Bearer ${t}`);
const LAST_MONTH = new Date(Date.now() - 32 * 86400000).toISOString().slice(0, 10);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'bdSuper', role: 'superadmin' });
  await makeUser({ name: 'bdStaff', role: 'staff' });
  superTok = await loginStaff(app, 'bdSuper');
  staffTok = await loginStaff(app, 'bdStaff');

  const Inventory = mongoose.model('Inventory');
  const Product = mongoose.model('Product');
  const Category = mongoose.model('Category');
  await Category.create({ name: 'BDCat', department: 'Logistics' });
  inv = await Inventory.create({ itemName: 'Widget', stockQty: 100, unit: 'pcs', unitCost: 40, lowStockThreshold: 5 });
  // 1:1 logistics good linked to the inventory item by code.
  prod = await Product.create({ name: 'Widget', category: 'BDCat', basePrice: 100, productCode: String(inv._id) });
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('backdated sale', () => {
  it('rejects a non-superadmin', async () => {
    const res = await auth('post', '/api/admin/backdate-sale', staffTok).send({ date: LAST_MONTH, amount: 500 });
    expect(res.status).toBe(403);
  });

  it('rejects a future date', async () => {
    const future = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    const res = await auth('post', '/api/admin/backdate-sale', superTok).send({ date: future, amount: 500 });
    expect(res.status).toBe(400);
  });

  it('itemized, inventory OFF (default): posts revenue dated to the day and does NOT touch stock', async () => {
    const Inventory = mongoose.model('Inventory');
    const before = (await Inventory.findById(inv._id).lean()).stockQty;

    const res = await auth('post', '/api/admin/backdate-sale', superTok).send({
      date: LAST_MONTH,
      items: [{ name: 'Widget', price: 100, quantity: 3, productId: String(prod._id), productCode: String(inv._id) }],
      // affectInventory omitted → default false
    });
    expect(res.status).toBe(200);
    expect(res.body.order.isBackdated).toBe(true);
    expect(res.body.order.total).toBe(300);
    // Order is dated to the chosen day.
    expect(new Date(res.body.order.createdAt).toISOString().slice(0, 10)).toBe(LAST_MONTH);

    const after = (await Inventory.findById(inv._id).lean()).stockQty;
    expect(after).toBe(before); // stock untouched

    // Journal entry is dated to the backdate and has NO COGS (revenue-only).
    const JournalEntry = mongoose.model('JournalEntry');
    const je = await JournalEntry.findOne({ description: new RegExp(res.body.order.orderNumber) }).lean();
    expect(new Date(je.date).toISOString().slice(0, 10)).toBe(LAST_MONTH);
    expect(je.lines.some(l => l.accountCode === '510000')).toBe(false); // no COGS
    expect(je.totalDebit).toBeCloseTo(je.totalCredit, 6);
  });

  it('itemized, inventory ON: deducts stock and books COGS, still balanced', async () => {
    const Inventory = mongoose.model('Inventory');
    const before = (await Inventory.findById(inv._id).lean()).stockQty;

    const res = await auth('post', '/api/admin/backdate-sale', superTok).send({
      date: LAST_MONTH,
      affectInventory: true,
      items: [{ name: 'Widget', price: 100, quantity: 2, productId: String(prod._id), productCode: String(inv._id) }],
    });
    expect(res.status).toBe(200);

    const after = (await Inventory.findById(inv._id).lean()).stockQty;
    expect(before - after).toBe(2); // stock reduced by the sold quantity

    const JournalEntry = mongoose.model('JournalEntry');
    const je = await JournalEntry.findOne({ description: new RegExp(res.body.order.orderNumber) }).lean();
    const cogs = je.lines.find(l => l.accountCode === '510000');
    expect(cogs).toBeTruthy();
    expect(cogs.debit).toBeCloseTo(80, 2); // 2 units × ₱40 unit cost
    expect(je.totalDebit).toBeCloseTo(je.totalCredit, 6);
  });

  it('complimentary backdated sale books Comp Expense / Revenue, collects nothing', async () => {
    const res = await auth('post', '/api/admin/backdate-sale', superTok).send({
      date: LAST_MONTH, isComplimentary: true,
      items: [{ name: 'Widget', price: 100, quantity: 2, productId: String(prod._id) }],
    });
    expect(res.status).toBe(200);
    expect(res.body.order.isComplimentary).toBe(true);
    expect(res.body.order.total).toBe(0); // free - nothing collected

    const JournalEntry = mongoose.model('JournalEntry');
    const je = await JournalEntry.findOne({ description: new RegExp(res.body.order.orderNumber) }).lean();
    expect(je.lines.some(l => l.accountCode === '540000')).toBe(true); // Complimentary Expense
    expect(je.lines.some(l => l.accountCode === '410000')).toBe(true); // Revenue
    expect(je.lines.some(l => l.accountCode === '111000')).toBe(false); // no cash collected
    expect(je.totalDebit).toBeCloseTo(je.totalCredit, 6);
  });

  it('discounted backdated sale posts a Sales Discounts line and stays balanced', async () => {
    const res = await auth('post', '/api/admin/backdate-sale', superTok).send({
      date: LAST_MONTH, discountPercent: 10,
      items: [{ name: 'Widget', price: 100, quantity: 5, productId: String(prod._id) }],
    });
    expect(res.status).toBe(200);
    expect(res.body.order.total).toBe(450); // 500 gross − 10%
    const JournalEntry = mongoose.model('JournalEntry');
    const je = await JournalEntry.findOne({ description: new RegExp(res.body.order.orderNumber) }).lean();
    expect(je.lines.find(l => l.accountCode === '430000')?.debit).toBeCloseTo(50, 2);
    expect(je.totalDebit).toBeCloseTo(je.totalCredit, 6);
  });

  it('legacy lump-sum form still works', async () => {
    const res = await auth('post', '/api/admin/backdate-sale', superTok).send({ date: LAST_MONTH, amount: 750, paymentMethod: 'Cash' });
    expect(res.status).toBe(200);
    expect(res.body.order.total).toBe(750);
  });

  it('rejects a second import of the same importRef as a duplicate (409)', async () => {
    const first = await auth('post', '/api/admin/backdate-sale', superTok).send({
      date: LAST_MONTH, paymentMethod: 'Cash', importRef: 'TXN-DUPE-001',
      items: [{ name: 'Widget', price: 100, quantity: 1, productId: String(prod._id) }],
    });
    expect(first.status).toBe(200);

    const second = await auth('post', '/api/admin/backdate-sale', superTok).send({
      date: LAST_MONTH, paymentMethod: 'Cash', importRef: 'TXN-DUPE-001',
      items: [{ name: 'Widget', price: 100, quantity: 1, productId: String(prod._id) }],
    });
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/already imported/i);

    const Order = mongoose.model('Order');
    const count = await Order.countDocuments({ importRef: 'TXN-DUPE-001' });
    expect(count).toBe(1); // only the first one landed
  });

  it('blank importRef never dedupes - two manual entries with no reference both post', async () => {
    const a = await auth('post', '/api/admin/backdate-sale', superTok).send({
      date: LAST_MONTH, paymentMethod: 'Cash',
      items: [{ name: 'Widget', price: 100, quantity: 1, productId: String(prod._id) }],
    });
    const b = await auth('post', '/api/admin/backdate-sale', superTok).send({
      date: LAST_MONTH, paymentMethod: 'Cash',
      items: [{ name: 'Widget', price: 100, quantity: 1, productId: String(prod._id) }],
    });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
  });

  it('backdate-sale/queue skips duplicate transNo rows and reports the count', async () => {
    const first = await auth('post', '/api/admin/backdate-sale/queue', superTok).send({
      items: [{ transNo: 'TXN-Q-001', client: 'Client A', date: LAST_MONTH,
        items: [{ name: 'Widget', price: 100, quantity: 1 }] }],
    });
    expect(first.body.queued).toBe(1);

    const second = await auth('post', '/api/admin/backdate-sale/queue', superTok).send({
      items: [{ transNo: 'TXN-Q-001', client: 'Client A', date: LAST_MONTH,
        items: [{ name: 'Widget', price: 100, quantity: 1 }] }],
    });
    expect(second.body.queued).toBe(0);
    expect(second.body.skippedDuplicates).toBe(1);
  });

  it('a backdated sale with a delivery fee folds it into total and stays balanced (bulk import reconciliation)', async () => {
    const res = await auth('post', '/api/admin/backdate-sale', superTok).send({
      date: LAST_MONTH, paymentMethod: 'Cash', deliveryFee: 60,
      items: [{ name: 'Widget', price: 100, quantity: 2, productId: String(prod._id) }],
    });
    expect(res.status).toBe(200);
    // subtotal 200, no discount, +60 delivery = 260 - previously this stayed
    // at 200, which is exactly the "doesn't tally against the source sheet"
    // gap the bulk backdate importer hits when a billing statement's own
    // total already includes a delivery/freight fee.
    expect(res.body.order.total).toBe(260);
    expect(res.body.order.deliveryFee).toBe(60);

    const JournalEntry = mongoose.model('JournalEntry');
    const je = await JournalEntry.findOne({ description: new RegExp(res.body.order.orderNumber) }).lean();
    expect(je.totalDebit).toBeCloseTo(je.totalCredit, 6);
    expect(je.totalDebit).toBeCloseTo(260, 2);
  });

  it('the whole ledger stays balanced after all the backdated entries', async () => {
    const { debits, credits } = await trialBalance();
    expect(Math.abs(debits - credits)).toBeLessThanOrEqual(0.01);
  });
});
