// The cash forecast, cashier performance and supplier price reports, and the
// sign-in trail. All of them only read what is already recorded - except the
// trail, which writes one audit line per sign-in and nothing else.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;
const as = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const M = (n) => mongoose.model(n);
const inDays = (n) => new Date(Date.now() + n * 86400000);

async function sale(price, extra = {}) {
  const o = await as('post', '/api/orders').send({ table: 'Pickup', items: [{ name: 'Open Item', price, quantity: 1 }], ...extra });
  expect(o.body.success, JSON.stringify(o.body)).toBe(true);
  await as('put', `/api/orders/${o.body.order._id}`).send({ status: 'Preparing', ...(extra.paymentMethod ? { paymentMethod: extra.paymentMethod } : {}) });
  await as('put', `/api/orders/${o.body.order._id}`).send({ status: 'Completed' });
  return o.body.order._id;
}

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'moneyOwner', role: 'superadmin', password: 'ownerpass1' });
  tok = await loginStaff(app, 'moneyOwner', 'ownerpass1');
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('the cash forecast', () => {
  it('places what is owed and what is due in the week it falls, and carries the cash forward', async () => {
    const client = (await as('post', '/api/client-accounts').send({ username: 'fcco', password: 'secret123', name: 'Forecast Co', paymentMethod: 'On Account' })).body.client;
    const soon = await sale(1000, { clientAccountId: client._id, paymentMethod: 'On Account' });
    const late = await sale(400, { clientAccountId: client._id, paymentMethod: 'On Account' });
    const undated = await sale(250, { clientAccountId: client._id, paymentMethod: 'On Account' });
    await M('Order').updateOne({ _id: soon }, { $set: { arDueDate: inDays(10) } });      // week 2
    await M('Order').updateOne({ _id: late }, { $set: { arDueDate: inDays(-5) } });      // overdue -> week 1
    await M('Order').updateOne({ _id: undated }, { $set: { arDueDate: null } });

    const bill = (over) => M('Bill').create({ businessType: 'log', billNumber: `BILL-FC-${Math.random().toString(36).slice(2, 7)}`, supplierName: 'Acme', supplierId: new mongoose.Types.ObjectId(), source: 'Manual', description: 'x', amount: 100, status: 'Approved', ...over });
    await bill({ amount: 600, dueDate: inDays(3) });                                     // week 1
    await bill({ amount: 900, paidAmount: 400, status: 'Partially Paid', dueDate: inDays(9) });   // 500 left, week 2
    await bill({ amount: 300, status: 'Pending', dueDate: inDays(16) });                 // week 3, not yet approved
    await bill({ amount: 5000, status: 'Paid', dueDate: inDays(2) });                    // settled: not counted

    const res = await as('get', '/api/reports/cash-forecast?days=28');
    expect(res.status).toBe(200);
    const f = res.body;
    expect(f.weeks).toHaveLength(4);
    expect(f.weeks.map(w => [w.in, w.out])).toEqual([[400, 600], [1000, 500], [0, 300], [0, 0]]);
    expect(f.expectedIn).toMatchObject({ total: 1650, overdue: 400, undated: 250 });
    expect(f.expectedOut).toMatchObject({ total: 1400 });
    expect(f.awaitingApproval).toBe(300);
    // Each week's cash is the last week's plus what came in, less what went out.
    let running = f.cashNow;
    for (const w of f.weeks) { running = Math.round((running + w.in - w.out) * 100) / 100; expect(w.balance).toBe(running); }
    expect(f.endingBalance).toBe(running);
    expect(f.lowest.balance).toBe(Math.min(f.cashNow, ...f.weeks.map(w => w.balance)));
    expect(f.shortfall).toBe(f.lowest.balance < 0);
  });

  it('keeps the window between one and thirteen weeks', async () => {
    expect((await as('get', '/api/reports/cash-forecast?days=1')).body.weeks).toHaveLength(1);
    expect((await as('get', '/api/reports/cash-forecast?days=999')).body.weeks).toHaveLength(13);
  });
});

describe('cashier performance', () => {
  it('counts sales, voids, refunds, discounts and complimentary orders per cashier', async () => {
    const before = (await as('get', '/api/reports/cashier-performance')).body.totals;
    const O = M('Order');
    const mk = (over) => O.create({
      businessType: 'log', orderNumber: `CP-${Math.random().toString(36).slice(2, 8)}`, table: 'Pickup', items: [],
      subtotal: 100, total: 100, status: 'Completed', paymentMethod: 'Cash', cashier: 'Ana', ...over,
    });
    await mk({ total: 500 });
    await mk({ total: 300, discount: 50 });
    await mk({ total: 200, refundedAmount: 80 });
    await mk({ total: 150, status: 'Voided' });
    await mk({ total: 0, isComplimentary: true });
    await mk({ total: 900, cashier: 'Ben' });

    const res = await as('get', '/api/reports/cashier-performance');
    const who = (n) => res.body.cashiers.find(c => c.name.toLowerCase() === n);
    const ana = who('ana');
    expect(ana).toMatchObject({
      sales: 1000, orders: 3, voids: 1, voidValue: 150, voidRate: 25,
      refunds: 1, refundValue: 80, discounted: 1, discountValue: 50, complimentary: 1,
    });
    expect(who('ben')).toMatchObject({ sales: 900, orders: 1, voids: 0, voidRate: 0 });
    expect(res.body.totals.sales).toBe(before.sales + 1900);
    expect(res.body.totals.voids).toBe(before.voids + 1);
  });
});

describe('supplier prices', () => {
  it('shows what each supplier last charged for an item, and who is cheapest', async () => {
    const po = (supplier, unitCost, createdAt, over = {}) => M('PurchaseOrder').create({
      poNumber: `PO-SP-${Math.random().toString(36).slice(2, 8)}`, supplier, status: 'Ordered', createdAt,
      lines: [{ purchaseType: 'inventory', itemName: 'Arabica Beans', itemCode: 'BEAN-1', unit: 'kg', orderedQty: 10, unitCost }], ...over,
    });
    await po('Acme', 420, inDays(-30));
    await po('Acme', 450, inDays(-2));            // Acme's latest
    await po('Bravo', 400, inDays(-10));
    await po('Cheapo', 100, inDays(-1), { status: 'Cancelled' });   // cancelled: ignored

    const res = await as('get', '/api/reports/supplier-prices');
    expect(res.status).toBe(200);
    const beans = res.body.items.find(i => i.itemCode === 'BEAN-1');
    expect(beans.supplierCount).toBe(2);
    expect(beans.cheapest).toBe('Bravo');
    expect(beans.suppliers.map(s => [s.supplier, s.lastCost])).toEqual([['Bravo', 400], ['Acme', 450]]);
    expect(beans.suppliers.find(s => s.supplier === 'Acme')).toMatchObject({ lowest: 420, highest: 450, orders: 2 });
    expect(beans.spread).toBe(12.5);              // 450 is 12.5% above 400
  });
});

describe('the sign-in trail', () => {
  const trail = () => M('AuditLog').find({ action: { $in: ['SIGN_IN', 'SIGN_IN_FAILED'] } }).sort({ timestamp: 1 }).lean();

  it('records a good sign-in, a wrong password and an unknown name - and never the password', async () => {
    const before = (await trail()).length;
    await request(app).post('/api/users/login').set('User-Agent', 'TestTill/1.0').send({ name: 'moneyOwner', password: 'ownerpass1' });
    await request(app).post('/api/users/login').send({ name: 'moneyOwner', password: 'wrong-guess-123' });
    await request(app).post('/api/users/login').send({ name: 'Nobody Here', password: 'whatever-123' });

    const rows = (await trail()).slice(before);
    expect(rows.map(r => [r.action, r.userId])).toEqual([['SIGN_IN', 'moneyOwner'], ['SIGN_IN_FAILED', 'moneyOwner'], ['SIGN_IN_FAILED', 'Nobody Here']]);
    expect(rows[0].details.device).toBe('TestTill/1.0');
    expect(JSON.stringify(rows)).not.toMatch(/ownerpass1|wrong-guess-123|whatever-123/);
  });
});
