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

describe('a backdated sale paid by check', () => {
  it('needs the check number', async () => {
    const res = await auth('post', '/api/admin/backdate-sale', superTok).send({ date: LAST_MONTH, amount: 500, paymentMethod: 'Check' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/check number/i);
  });

  it('keeps the check number and date on the order', async () => {
    const res = await auth('post', '/api/admin/backdate-sale', superTok).send({
      date: LAST_MONTH, amount: 750, paymentMethod: 'Check', paymentReference: ' 0012345 ', paymentCheckDate: LAST_MONTH,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const o = await mongoose.model('Order').findById(res.body.order._id).lean();
    expect(o.paymentMethod).toBe('Check');
    expect(o.paymentReference).toBe('0012345');
    expect(o.paymentCheckDate.toISOString().slice(0, 10)).toBe(LAST_MONTH);
  });
});

describe('an imported billing statement lands on its own grand total', () => {
  it('the sheet discount comes off in pesos, exactly', async () => {
    const res = await auth('post', '/api/admin/backdate-sale', superTok).send({
      date: LAST_MONTH, paymentMethod: 'Cash', importRef: 'GT-1',
      items: [{ name: 'Beans A', price: 11070.5, quantity: 2 }], discountAmount: 442.82,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.order.total).toBe(21698.18);
    expect(res.body.order.discount).toBe(442.82);
  });

  it('a queued sale keeps the discount and the sheet reference', async () => {
    const q = await auth('post', '/api/admin/backdate-sale/queue', superTok).send({ items: [{
      transNo: 'GT-2', client: 'Queued Co', date: LAST_MONTH,
      items: [{ name: 'Beans B', price: 1000, quantity: 3 }], deliveryFee: 150, discountAmount: 200,
    }] });
    expect(q.body.queued).toBe(1);
    const row = await mongoose.model('BackdateQueueItem').findOne({ transNo: 'GT-2' }).lean();
    const saved = await auth('post', `/api/admin/backdate-sale/queue/${row._id}/save`, superTok).send({ paymentMethod: 'Cash' });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.order.total).toBe(2950);   // 3000 + 150 delivery - 200 discount
    expect(saved.body.order.importRef).toBe('GT-2');
  });
});

describe('importing an Orders export back', () => {
  const imp = (body) => auth('post', '/api/orders/import', superTok).send(body);

  it('a summary row comes back on its date, with its number, total and client', async () => {
    const client = await mongoose.model('ClientAccount').create({ name: 'IMPORT CLIENT', clientCode: 'IMP-1', username: 'impclient', password: 'x' });
    const r = await imp({ rows: [{ 'Order No': 'ORD-2026-A9001', Date: LAST_MONTH, Customer: 'Import Client', Status: 'Completed', Payment: 'On Account', Subtotal: 1000, Discount: 50, Total: 950 }] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.created).toBe(1);
    const o = await mongoose.model('Order').findOne({ orderNumber: 'ORD-2026-A9001' }).lean();
    expect(o).toBeTruthy();
    expect(o.total).toBe(950);
    expect(o.discount).toBe(50);
    expect(o.paymentMethod).toBe('On Account');
    expect(o.clientId).toBe(String(client._id));
    expect(o.createdAt.toISOString().slice(0, 10)).toBe(LAST_MONTH);
  });

  it('importing the same file again adds nothing', async () => {
    const r = await imp({ rows: [{ 'Order No': 'ORD-2026-A9001', Date: LAST_MONTH, Status: 'Completed', Total: 950 }] });
    expect(r.body.created).toBe(0);
    expect(await mongoose.model('Order').countDocuments({ orderNumber: 'ORD-2026-A9001' })).toBe(1);
  });

  it('only completed orders come back', async () => {
    const r = await imp({ rows: [{ 'Order No': 'ORD-2026-A9002', Date: LAST_MONTH, Status: 'Cancelled', Total: 500 }] });
    expect(r.body.created).toBe(0);
    expect(r.body.skipped[0].error).toMatch(/only completed/i);
  });

  it('with its lines, the products come back too', async () => {
    const r = await imp({
      rows: [{ 'Order No': 'ORD-2026-A9003', Date: LAST_MONTH, Status: 'Completed', Payment: 'Cash', Subtotal: 600, Discount: 0, Total: 600 }],
      lines: [
        { 'Order No': 'ORD-2026-A9003', Product: 'Line A', Qty: 2, 'Unit Price': 200 },
        { 'Order No': 'ORD-2026-A9003', Product: 'Line B', Qty: 1, 'Unit Price': 200 },
      ],
    });
    expect(r.body.created).toBe(1);
    const o = await mongoose.model('Order').findOne({ orderNumber: 'ORD-2026-A9003' }).lean();
    expect(o.items.map(i => i.name)).toEqual(['Line A', 'Line B']);
    expect(o.total).toBe(600);
  });

  it('a new order after the import never reuses an imported number', async () => {
    const res = await auth('post', '/api/admin/backdate-sale', superTok).send({ date: LAST_MONTH, amount: 10 });
    const n = Number(/-A(\d+)$/.exec(res.body.order.orderNumber)[1]);
    expect(n).toBeGreaterThan(9003);
  });
});
