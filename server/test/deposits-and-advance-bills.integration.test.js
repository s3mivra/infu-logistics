// Two places where the documents and the ledger used to disagree.
//
// 1. Money prepaid on a partly fulfilled order was booked to 260000 (the
//    Other Liabilities header) while the Advances screen kept deposits in
//    260200 - the same kind of money in two places on the balance sheet.
//    New deposits now go to 260200 and are released from it.
// 2. Applying a supplier advance to a bill debited Accounts Payable but never
//    recorded the payment on the bill, so the bill still showed as owing.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok, product;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const M = (n) => mongoose.model(n);
const lineFor = (je, code) => (je?.lines || []).find(l => l.accountCode === code);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'DepBillSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'DepBillSuper');
  await M('Category').create({ name: 'Goods', department: 'Logistics' });
  product = await M('Product').create({ productCode: 'G-1', name: 'Crate', category: 'Goods', basePrice: 100 });
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('deposits on partly fulfilled orders', () => {
  it('holds the prepaid remainder in 260200 and releases it from there', async () => {
    const { body: { order } } = await auth('post', '/api/orders').send({
      table: 'Pickup', paymentMethod: 'Cash',
      items: [{ productId: String(product._id), name: 'Crate', price: 100, quantity: 4 }],
    });

    const first = await auth('post', `/api/orders/${order._id}/partial-fulfill`)
      .send({ fulfill: [{ index: 0, qty: 1 }], paymentMode: 'full', paymentMethod: 'Cash' });
    expect(first.body.success).toBe(true);
    const held = await M('JournalEntry').find({ 'lines.accountCode': '260200' }).lean();
    expect(held.some(je => lineFor(je, '260200')?.credit === 300)).toBe(true);
    expect(await M('JournalEntry').countDocuments({ 'lines.accountCode': '260000' })).toBe(0);
    expect((await M('Order').findById(order._id).lean()).depositAccount).toBe('260200');

    const rest = await auth('post', `/api/orders/${order._id}/partial-fulfill`)
      .send({ fulfill: [{ index: 0, qty: 3 }], paymentMode: 'partial', paymentMethod: 'Cash' });
    expect(rest.body.success).toBe(true);
    const all = await M('JournalEntry').find({ 'lines.accountCode': '260200' }).lean();
    const net = all.reduce((s, je) => s + je.lines.filter(l => l.accountCode === '260200').reduce((t, l) => t + l.credit - l.debit, 0), 0);
    expect(net).toBeCloseTo(0, 2);
  }, 30000);

  it('keeps releasing a deposit that was started in the old account from that account', async () => {
    const { body: { order } } = await auth('post', '/api/orders').send({
      table: 'Pickup', paymentMethod: 'Cash',
      items: [{ productId: String(product._id), name: 'Crate', price: 100, quantity: 2 }],
    });
    // Simulate an order whose deposit was booked before the change.
    await M('Order').updateOne({ _id: order._id }, { $set: { status: 'Partially Fulfilled', depositRemaining: 100, amountPaid: 200, 'items.0.fulfilledQty': 1 } });
    const res = await auth('post', `/api/orders/${order._id}/partial-fulfill`)
      .send({ fulfill: [{ index: 0, qty: 1 }], paymentMode: 'partial', paymentMethod: 'Cash' });
    expect(res.body.success).toBe(true);
    const je = await M('JournalEntry').findOne({ 'lines.accountCode': '260000' }).lean();
    expect(lineFor(je, '260000').debit).toBe(100);
  }, 30000);
});

describe('applying a supplier advance to a bill', () => {
  const approvedBill = async (amount) => {
    const supplier = await M('Supplier').create({ name: `Supplier ${amount}` });
    const created = await auth('post', '/api/bills').send({ supplierId: String(supplier._id), amount, description: 'Stock', expenseAccountCode: '610000' });
    expect(created.body.success).toBe(true);
    await auth('post', `/api/bills/${created.body.bill._id}/approve`).send({});
    return { bill: created.body.bill, supplier };
  };

  it('records the payment on the bill, partly then fully', async () => {
    const { bill, supplier } = await approvedBill(1000);
    const { body: { advance } } = await auth('post', '/api/advances').send({ type: 'supplier', payeeName: supplier.name, amount: 600 });

    const res = await auth('post', `/api/advances/${advance._id}/liquidate`).send({ method: 'bill', billId: bill._id });
    expect(res.status).toBe(200);
    let fresh = await M('Bill').findById(bill._id).lean();
    expect(fresh.paidAmount).toBe(600);
    expect(fresh.status).toBe('Partially Paid');
    expect(fresh.payments.at(-1).referenceNumber).toMatch(/Advance/);

    const { body: { advance: second } } = await auth('post', '/api/advances').send({ type: 'supplier', payeeName: supplier.name, amount: 900 });
    const rest = await auth('post', `/api/advances/${second._id}/liquidate`).send({ method: 'bill', billId: bill._id });
    expect(rest.status).toBe(200);
    expect(rest.body.advance.outstanding).toBe(500);   // only 400 was owed
    fresh = await M('Bill').findById(bill._id).lean();
    expect(fresh.status).toBe('Paid');
  }, 30000);

  it('refuses a pending bill and more than the bill still owes', async () => {
    const supplier = await M('Supplier').create({ name: 'Pending Co' });
    const pending = await auth('post', '/api/bills').send({ supplierId: String(supplier._id), amount: 500, description: 'x', expenseAccountCode: '610000' });
    const { body: { advance } } = await auth('post', '/api/advances').send({ type: 'supplier', payeeName: 'Pending Co', amount: 800 });
    expect((await auth('post', `/api/advances/${advance._id}/liquidate`).send({ method: 'bill', billId: pending.body.bill._id })).status).toBe(409);

    const { bill } = await approvedBill(300);
    const over = await auth('post', `/api/advances/${advance._id}/liquidate`).send({ method: 'bill', billId: bill._id, amount: 700 });
    expect(over.status).toBe(400);
  }, 30000);
});
