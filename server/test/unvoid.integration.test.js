// Un-void: reversing a void must leave stock and the ledger exactly as they were
// before the void - no erasure, an equal-and-opposite entry.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let app, stop, superToken, invId, productId;

const auth = (t) => ({ Authorization: `Bearer ${t}` });

const makeSale = async (qty = 2) => {
  const created = await request(app).post('/api/orders').set(auth(superToken)).send({
    customerName: 'Unvoid Tester', paymentMethod: 'Cash',
    items: [{ productId, name: 'Unvoid Widget', price: 100, quantity: qty }],
  });
  const id = created.body.order._id;
  await request(app).put(`/api/orders/${id}`).set(auth(superToken)).send({ status: 'Completed' });
  return created.body.order;
};

const stockOf = async () => (await mongoose.model('Inventory').findById(invId).lean()).stockQty;

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'log', jwtSecret: 'unvoid-secret-0123456789' }));
  await makeUser({ name: 'UnvoidBoss', role: 'superadmin', password: 'pw' });
  await mongoose.model('User').updateMany({}, { $set: { tenantId: null } });
  superToken = await loginStaff(app, 'UnvoidBoss', 'pw');

  const inv = await mongoose.model('Inventory').create({
    itemCode: 'UV-WIDGET', itemName: 'Unvoid Widget', stockQty: 1000, unit: 'pcs',
    unitCost: 40, displayUnit: 'pcs', unitMultiplier: 1, packSize: 1, businessType: 'log',
  });
  invId = String(inv._id);
  const prod = await request(app).post('/api/products').set(auth(superToken))
    .send({ name: 'Unvoid Widget', category: 'Dry Goods', basePrice: 100 });
  productId = prod.body.product._id;
}, 120000);

afterAll(async () => { await stop(); });

describe('reversing a void', () => {
  it('restores the order to Completed and clears the void stamps', async () => {
    const order = await makeSale();
    await request(app).post(`/api/orders/${order._id}/void`).set(auth(superToken)).send({ reason: 'Restock' });

    const res = await request(app).post(`/api/orders/${order._id}/unvoid`).set(auth(superToken));
    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe('Completed');
    expect(res.body.order.voidReason).toBe('');
    expect(res.body.order.voidedBy).toBe('');
  });

  it('returns stock to exactly its pre-void level', async () => {
    const before = await stockOf();
    const order = await makeSale(3);
    const afterSale = await stockOf();

    await request(app).post(`/api/orders/${order._id}/void`).set(auth(superToken)).send({ reason: 'Restock' });
    const afterVoid = await stockOf();
    expect(afterVoid).toBeGreaterThan(afterSale);          // the void put stock back

    await request(app).post(`/api/orders/${order._id}/unvoid`).set(auth(superToken));
    const afterUnvoid = await stockOf();
    expect(afterUnvoid).toBeCloseTo(afterSale, 6);         // and un-voiding takes it out again
    expect(afterUnvoid).toBeLessThan(before);
  });

  it('does NOT delete the void entry - it posts an equal and opposite one', async () => {
    const order = await makeSale();
    await request(app).post(`/api/orders/${order._id}/void`).set(auth(superToken)).send({ reason: 'Restock' });
    await request(app).post(`/api/orders/${order._id}/unvoid`).set(auth(superToken));

    const JE = mongoose.model('JournalEntry');
    const voidEntry = await JE.findOne({ reference: `VOID-${order.orderNumber}` }).lean();
    const unvoidEntry = await JE.findOne({ reference: `UNVOID-${order.orderNumber}` }).lean();
    expect(voidEntry).toBeTruthy();      // original preserved for the audit trail
    expect(unvoidEntry).toBeTruthy();
    // Mirrored: the reversal's debits equal the void's credits and vice versa.
    expect(unvoidEntry.totalDebit).toBeCloseTo(voidEntry.totalCredit, 2);
    expect(unvoidEntry.totalCredit).toBeCloseTo(voidEntry.totalDebit, 2);
  });

  it('leaves the two entries summing to zero per account', async () => {
    const order = await makeSale();
    await request(app).post(`/api/orders/${order._id}/void`).set(auth(superToken)).send({ reason: 'Restock' });
    await request(app).post(`/api/orders/${order._id}/unvoid`).set(auth(superToken));

    const JE = mongoose.model('JournalEntry');
    const both = await JE.find({ reference: { $in: [`VOID-${order.orderNumber}`, `UNVOID-${order.orderNumber}`] } }).lean();
    const net = {};
    for (const e of both) for (const l of e.lines) {
      net[l.accountCode] = (net[l.accountCode] || 0) + (l.debit || 0) - (l.credit || 0);
    }
    for (const [code, amount] of Object.entries(net)) {
      expect(Math.abs(amount), `account ${code} did not net to zero`).toBeLessThan(0.01);
    }
  });
});

describe('guards', () => {
  it('refuses to un-void an order that is not voided', async () => {
    const order = await makeSale();
    const res = await request(app).post(`/api/orders/${order._id}/unvoid`).set(auth(superToken));
    expect(res.status).toBe(400);
  });

  it('refuses a second un-void, so the reversal cannot be posted twice', async () => {
    const order = await makeSale();
    const v1 = await request(app).post(`/api/orders/${order._id}/void`).set(auth(superToken)).send({ reason: 'Restock' });
    expect(v1.status, `first void failed: ${JSON.stringify(v1.body)}`).toBe(200);
    const u1 = await request(app).post(`/api/orders/${order._id}/unvoid`).set(auth(superToken));
    expect(u1.status, `first unvoid failed: ${JSON.stringify(u1.body)}`).toBe(200);

    // Re-void, then attempt to reverse again - the existing UNVOID reference must block it.
    const v2 = await request(app).post(`/api/orders/${order._id}/void`).set(auth(superToken)).send({ reason: 'Restock' });
    expect(v2.status, `second void failed: ${JSON.stringify(v2.body)}`).toBe(200);
    const second = await request(app).post(`/api/orders/${order._id}/unvoid`).set(auth(superToken));
    expect(second.status).toBe(409);
  });

  it('refuses to un-void a refund', async () => {
    const order = await makeSale();
    await mongoose.model('Order').updateOne(
      { _id: order._id }, { $set: { status: 'Voided', voidReason: 'REFUND: customer changed mind' } }
    );
    const res = await request(app).post(`/api/orders/${order._id}/unvoid`).set(auth(superToken));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/refund/i);
  });

  it('requires superadmin', async () => {
    await makeUser({ name: 'UvCashier', role: 'cashier', password: 'pw' });
    await mongoose.model('User').updateMany({}, { $set: { tenantId: null } });
    const cashier = await loginStaff(app, 'UvCashier', 'pw');
    const order = await makeSale();
    await request(app).post(`/api/orders/${order._id}/void`).set(auth(superToken)).send({ reason: 'Restock' });
    const res = await request(app).post(`/api/orders/${order._id}/unvoid`).set(auth(cashier));
    expect(res.status).toBe(403);
  });

  it('404s on a missing order', async () => {
    const res = await request(app).post(`/api/orders/${new mongoose.Types.ObjectId()}/unvoid`).set(auth(superToken));
    expect(res.status).toBe(404);
  });
});
