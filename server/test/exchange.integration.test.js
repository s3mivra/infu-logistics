// Exchange: return some line(s)/qty AND add a replacement item on the SAME
// order, net-settled in one cash movement. Builds on the same fixture pattern
// as partial-refund.integration.test.js (1:1 logistics products linked to
// their own Inventory item by exact name match - avoid ALL-CAPS acronym names,
// they get title-cased on the Product and would break the name match).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let app, stop, superToken, cashierToken;
let invOldId, invCheapId, invPricyId, productOldId, productCheapId, productPricyId;

const auth = (t) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'log', jwtSecret: 'exchange-secret-0123456789' }));
  await makeUser({ name: 'ExBoss', role: 'superadmin', password: 'pw' });
  await makeUser({ name: 'ExCashier', role: 'cashier', password: 'pw' });
  await mongoose.model('User').updateMany({}, { $set: { tenantId: null } });
  superToken = await loginStaff(app, 'ExBoss', 'pw');
  cashierToken = await loginStaff(app, 'ExCashier', 'pw');

  const mk = async (code, name, unitCost, basePrice) => {
    const inv = await mongoose.model('Inventory').create({
      itemCode: code, itemName: name, stockQty: 1000, unit: 'pcs',
      unitCost, displayUnit: 'pcs', unitMultiplier: 1, packSize: 1, businessType: 'log',
    });
    const prod = await request(app).post('/api/products').set(auth(superToken))
      .send({ name, category: 'Dry Goods', basePrice });
    return { invId: String(inv._id), productId: prod.body.product._id };
  };

  const old = await mk('EX-OLD', 'Widget Original', 40, 100);      // ordered item: ₱100
  const cheap = await mk('EX-CHEAP', 'Widget Cheaper', 20, 60);    // downgrade replacement: ₱60
  const pricy = await mk('EX-PRICY', 'Widget Pricier', 60, 150);   // upgrade replacement: ₱150
  invOldId = old.invId; productOldId = old.productId;
  invCheapId = cheap.invId; productCheapId = cheap.productId;
  invPricyId = pricy.invId; productPricyId = pricy.productId;
}, 120000);

afterAll(async () => { await stop(); });

const stockOf = async (id) => (await mongoose.model('Inventory').findById(id).lean()).stockQty;

const makeSale = async (qty = 2) => {
  const created = await request(app).post('/api/orders').set(auth(superToken)).send({
    customerName: 'Exchange Tester', paymentMethod: 'Cash',
    items: [{ productId: productOldId, name: 'Widget Original', price: 100, quantity: qty }],
  });
  const id = created.body.order._id;
  await request(app).put(`/api/orders/${id}`).set(auth(superToken)).send({ status: 'Completed' });
  const res = await request(app).get(`/api/orders/${id}`).set(auth(superToken));
  return res.body.order || res.body;
};

describe('exchange - upgrade (replacement costs more)', () => {
  it('charges the customer the difference and adds the new line to the same order', async () => {
    const order = await makeSale(2); // 2 × ₱100 = ₱200
    const stockOldBefore = await stockOf(invOldId);
    const stockPricyBefore = await stockOf(invPricyId);

    const res = await request(app).post(`/api/orders/${order._id}/exchange`).set(auth(superToken)).send({
      returnItems: [{ itemIndex: 0, qty: 1 }],           // return 1 × ₱100 = ₱100
      newItems: [{ productId: productPricyId, quantity: 1 }], // new 1 × ₱150 = ₱150
      reason: 'Customer wants the pricier model', inventoryAction: 'Restock',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.returnValue).toBeCloseTo(100, 2);
    expect(res.body.newCharge).toBeCloseTo(150, 2);
    expect(res.body.netDelta).toBeCloseTo(50, 2); // customer owes ₱50 more

    const updated = res.body.order;
    expect(updated.status).toBe('Completed'); // exchange never terminates the order
    expect(updated.items[0].refundedQty).toBe(1); // the returned unit tracked on the original line
    const newLine = updated.items.find(i => i.addedViaExchange);
    expect(newLine).toBeTruthy();
    expect(newLine.name).toBe('Widget Pricier');
    expect(newLine.quantity).toBe(1);
    expect(updated.total).toBeCloseTo(200 + 50, 2); // original total + net delta

    // Inventory: 1 unit of the original came back, 1 unit of the pricier one went out.
    expect(await stockOf(invOldId)).toBeCloseTo(stockOldBefore + 1, 6);
    expect(await stockOf(invPricyId)).toBeCloseTo(stockPricyBefore - 1, 6);
  });

  it('the journal entry balances and records the net cash collected', async () => {
    const order = await makeSale(2);
    await request(app).post(`/api/orders/${order._id}/exchange`).set(auth(superToken)).send({
      returnItems: [{ itemIndex: 0, qty: 1 }],
      newItems: [{ productId: productPricyId, quantity: 1 }],
      reason: 'Upgrade', inventoryAction: 'Restock',
    });
    const JournalEntry = mongoose.model('JournalEntry');
    const je = await JournalEntry.findOne({ reference: /^EXCHANGE/, description: new RegExp(order.orderNumber) }).sort({ createdAt: -1 }).lean();
    expect(je).toBeTruthy();
    expect(je.totalDebit).toBeCloseTo(je.totalCredit, 2);
    const cashLine = je.lines.find(l => l.accountCode === '111000' || l.accountName?.toLowerCase().includes('cash'));
    expect(cashLine?.debit || 0).toBeCloseTo(50, 2); // customer paid ₱50 more, cash increases
  });
});

describe('exchange - downgrade (replacement costs less)', () => {
  it('refunds the customer the difference', async () => {
    const order = await makeSale(2); // ₱200
    const res = await request(app).post(`/api/orders/${order._id}/exchange`).set(auth(superToken)).send({
      returnItems: [{ itemIndex: 0, qty: 1 }],            // return ₱100
      newItems: [{ productId: productCheapId, quantity: 1 }], // new ₱60
      reason: 'Customer wants the cheaper model', inventoryAction: 'None',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.netDelta).toBeCloseTo(-40, 2); // gets ₱40 back
    expect(res.body.order.total).toBeCloseTo(200 - 40, 2);
  });
});

describe('exchange - even swap (same value)', () => {
  it('nets to zero cash movement but still moves inventory and adds the line', async () => {
    // Buy the pricier one, exchange it for another unit of the same pricier product - even swap.
    const created = await request(app).post('/api/orders').set(auth(superToken)).send({
      customerName: 'Even Swap Tester', paymentMethod: 'Cash',
      items: [{ productId: productPricyId, name: 'Widget Pricier', price: 150, quantity: 1 }],
    });
    const id = created.body.order._id;
    await request(app).put(`/api/orders/${id}`).set(auth(superToken)).send({ status: 'Completed' });

    const res = await request(app).post(`/api/orders/${id}/exchange`).set(auth(superToken)).send({
      returnItems: [{ itemIndex: 0, qty: 1 }],
      newItems: [{ productId: productPricyId, quantity: 1 }],
      reason: 'Defective unit, same model swap', inventoryAction: 'Spoilage',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.netDelta).toBeCloseTo(0, 2);
    expect(res.body.order.total).toBeCloseTo(150, 2); // unchanged
    const newLine = res.body.order.items.find(i => i.addedViaExchange);
    expect(newLine).toBeTruthy();
  });
});

describe('exchange - guards', () => {
  it('requires at least one replacement item', async () => {
    const order = await makeSale();
    const res = await request(app).post(`/api/orders/${order._id}/exchange`).set(auth(superToken)).send({
      returnItems: [{ itemIndex: 0, qty: 1 }], newItems: [], reason: 'Nothing to add', inventoryAction: 'None',
    });
    expect(res.status).toBe(400);
  });

  it('requires a reason', async () => {
    const order = await makeSale();
    const res = await request(app).post(`/api/orders/${order._id}/exchange`).set(auth(superToken)).send({
      newItems: [{ productId: productCheapId, quantity: 1 }], inventoryAction: 'None',
    });
    expect(res.status).toBe(400);
  });

  it('rejects insufficient stock on the replacement without applying anything', async () => {
    const order = await makeSale();
    const stockOldBefore = await stockOf(invOldId);
    const res = await request(app).post(`/api/orders/${order._id}/exchange`).set(auth(superToken)).send({
      returnItems: [{ itemIndex: 0, qty: 1 }],
      newItems: [{ productId: productCheapId, quantity: 999999 }],
      reason: 'Too many', inventoryAction: 'None',
    });
    expect(res.status).toBe(400);
    // Nothing should have been applied - the return side must not have gone through either.
    expect(await stockOf(invOldId)).toBeCloseTo(stockOldBefore, 6);
    const check = await request(app).get(`/api/orders/${order._id}`).set(auth(superToken));
    const updated = check.body.order || check.body;
    expect(updated.items[0].refundedQty).toBe(0);
  });

  it('rejects an out-of-range return item index', async () => {
    const order = await makeSale();
    const res = await request(app).post(`/api/orders/${order._id}/exchange`).set(auth(superToken)).send({
      returnItems: [{ itemIndex: 9, qty: 1 }],
      newItems: [{ productId: productCheapId, quantity: 1 }],
      reason: 'Bad index', inventoryAction: 'None',
    });
    expect(res.status).toBe(400);
  });

  it('requires admin/superadmin, not a plain cashier', async () => {
    const order = await makeSale();
    const res = await request(app).post(`/api/orders/${order._id}/exchange`).set(auth(cashierToken)).send({
      newItems: [{ productId: productCheapId, quantity: 1 }], reason: 'Nope', inventoryAction: 'None',
    });
    expect(res.status).toBe(403);
  });

  it('refuses to exchange on a non-Completed order', async () => {
    const order = await makeSale();
    await mongoose.model('Order').updateOne({ _id: order._id }, { $set: { status: 'Voided' } });
    const res = await request(app).post(`/api/orders/${order._id}/exchange`).set(auth(superToken)).send({
      newItems: [{ productId: productCheapId, quantity: 1 }], reason: 'Already voided', inventoryAction: 'None',
    });
    expect(res.status).toBe(400);
  });

  it('allows an exchange with NO return side (pure add-on, customer just pays more)', async () => {
    const order = await makeSale();
    const res = await request(app).post(`/api/orders/${order._id}/exchange`).set(auth(superToken)).send({
      newItems: [{ productId: productCheapId, quantity: 1 }], reason: 'Customer wants one more item', inventoryAction: 'None',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.returnValue).toBe(0);
    expect(res.body.netDelta).toBeCloseTo(60, 2);
  });

  it('404s on a missing order', async () => {
    const res = await request(app).post(`/api/orders/${new mongoose.Types.ObjectId()}/exchange`).set(auth(superToken)).send({
      newItems: [{ productId: productCheapId, quantity: 1 }], reason: 'Missing', inventoryAction: 'None',
    });
    expect(res.status).toBe(404);
  });
});
