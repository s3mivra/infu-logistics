// Client-portal purchase flow (logistics mode), end-to-end over HTTP:
//   client logs in → places an order → sees only their own orders → staff fulfils it
//   (booked to A/R, since a client buys on their preset terms) → client confirms receipt.
// Plus the data-isolation guarantees: a client can neither see nor confirm another
// client's order.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, makeClient, loginStaff, loginClient } from './helpers/harness.js';

let ctx, app;
let staffTok, superTok, clientATok, clientBTok;
let prod, inv;
let orderId, orderNumber;

const orderBody = (qty = 1) => ({
  items: [{ productId: String(prod._id), name: 'Pallet', price: 100, quantity: qty }],
});

const post = (path, token, body) => request(app).post(path).set('Authorization', `Bearer ${token}`).send(body || {});
const get = (path, token) => request(app).get(path).set('Authorization', `Bearer ${token}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' }); // client portal is a logistics-mode feature
  app = ctx.app;

  await makeUser({ name: 'cpSuper2', role: 'superadmin' });
  await makeUser({ name: 'cpStaff2', role: 'staff' });
  await makeClient({ username: 'clientA', paymentMethod: 'Bank Transfer' }); // buys on terms → A/R
  await makeClient({ username: 'clientB', paymentMethod: 'Cash' });
  superTok = await loginStaff(app, 'cpSuper2');
  staffTok = await loginStaff(app, 'cpStaff2');
  clientATok = await loginClient(app, 'clientA');
  clientBTok = await loginClient(app, 'clientB');

  const Inventory = mongoose.model('Inventory');
  const Product = mongoose.model('Product');
  const Category = mongoose.model('Category');
  await Category.create({ name: 'Freight', department: 'Kitchen' }); // schema enum is Kitchen|Bar
  inv = await Inventory.create({ itemName: 'Pallet Stock', stockQty: 500, unit: 'pcs', unitCost: 20 });
  prod = await Product.create({
    name: 'Pallet', category: 'Freight', basePrice: 100,
    baseRecipe: [{ invId: String(inv._id), name: 'Pallet Stock', qty: 1, cost: 20, unit: 'pcs' }],
  });
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('client portal: a client buys from the portal', () => {
  it('client A places an order on their preset terms (billing number + identity stamped)', async () => {
    const res = await post('/api/orders', clientATok, orderBody(1));
    expect(res.status).toBe(200);
    const o = res.body.order;
    expect(o.placedByClient).toBe(true);
    expect(o.clientUsername).toBe('clientA');
    expect(o.paymentMethod).toBe('Bank Transfer');     // client's preset, not a body override
    expect(o.total).toBe(100);
    // Carries its series prefix: the counter was always keyed on BIL-, but the
    // stored number used to drop it and print a bare 2026-09-0001.
    expect(o.billingNumber).toMatch(/^BIL-\d{4}-\d{2}-\d{4}$/); // logistics monthly billing ref
    orderId = o._id;
    orderNumber = o.orderNumber;
  });

  it('client A sees their own order in the portal', async () => {
    const res = await get('/api/client/orders', clientATok);
    expect(res.status).toBe(200);
    expect(res.body.orders.some((r) => r.orderNumber === orderNumber)).toBe(true);
  });

  it('DATA ISOLATION: client B cannot see client A\'s order', async () => {
    const res = await get('/api/client/orders', clientBTok);
    expect(res.status).toBe(200);
    expect(res.body.orders.some((r) => r.orderNumber === orderNumber)).toBe(false);
  });

  it('staff fulfils the order: stock deducts and the sale books to A/R (not cash)', async () => {
    const Inventory = mongoose.model('Inventory');
    const JournalEntry = mongoose.model('JournalEntry');
    const before = (await Inventory.findById(inv._id).lean()).stockQty;

    const res = await request(app).put(`/api/orders/${orderId}`).set('Authorization', `Bearer ${staffTok}`).send({ status: 'Completed' });
    expect(res.status).toBe(200);

    const after = (await Inventory.findById(inv._id).lean()).stockQty;
    expect(before - after).toBe(1); // 1 pcs/unit × 1

    const je = await JournalEntry.findOne({ 'lines.accountCode': '410000', description: new RegExp(orderNumber) }).lean();
    expect(je.totalDebit).toBeCloseTo(je.totalCredit, 6);
    const codes = je.lines.map((l) => l.accountCode);
    expect(codes).toContain('120000');     // Accounts Receivable (Bank Transfer → A/R policy)
    expect(codes).not.toContain('111000'); // NOT Cash on Hand
  });

  it('the fulfilled client sale shows up as outstanding A/R', async () => {
    const res = await get('/api/finance/ar-outstanding', superTok);
    expect(res.status).toBe(200);
    expect(res.body.orders.some((r) => r.orderNumber === orderNumber)).toBe(true);
  });

  it('client A confirms receipt of their completed order', async () => {
    const res = await post(`/api/client/orders/${orderId}/received`, clientATok);
    expect(res.status).toBe(200);
    const Order = mongoose.model('Order');
    expect((await Order.findById(orderId).lean()).clientReceived).toBe(true);
  });

  it('DATA ISOLATION: client B cannot confirm receipt of client A\'s order', async () => {
    const Order = mongoose.model('Order');
    const a = await Order.create({ orderNumber: 'ORD-ISO-1', status: 'Completed', clientId: 'someoneElse', total: 50, paymentMethod: 'Cash' });
    const res = await post(`/api/client/orders/${a._id}/received`, clientBTok);
    expect(res.status).toBe(404); // ownership filter - not B's order
  });

  it('a not-yet-ready order cannot be confirmed received', async () => {
    const pending = await post('/api/orders', clientATok, orderBody(1));
    const res = await post(`/api/client/orders/${pending.body.order._id}/received`, clientATok);
    expect(res.status).toBe(400); // status is Pending, not ready
  });

  it('a client token is still rejected on staff order management (GET /api/orders)', async () => {
    const res = await get('/api/orders', clientATok);
    expect(res.status).toBe(403);
  });

  it('a client can cancel their own still-pending order', async () => {
    const placed = await post('/api/orders', clientATok, orderBody(1));
    const id = placed.body.order._id;
    expect(placed.body.order.status).toBe('Pending');
    const res = await post(`/api/client/orders/${id}/cancel`, clientATok);
    expect(res.status).toBe(200);
    const Order = mongoose.model('Order');
    expect(await Order.findById(id).lean()).toMatchObject({ status: 'Cancelled', cancelledByClient: true });
  });

  it('a client cannot cancel once the order left Pending (e.g. Preparing)', async () => {
    const placed = await post('/api/orders', clientATok, orderBody(1));
    const id = placed.body.order._id;
    await request(app).put(`/api/orders/${id}`).set('Authorization', `Bearer ${staffTok}`).send({ status: 'Preparing' });
    const res = await post(`/api/client/orders/${id}/cancel`, clientATok);
    expect(res.status).toBe(400);
  });

  it('a client cannot cancel a pending order we have taken payment for (it needs a refund)', async () => {
    const placed = await post('/api/orders', clientATok, orderBody(1));
    const id = placed.body.order._id;
    const Order = mongoose.model('Order');
    await Order.updateOne({ _id: id }, { $set: { amountPaid: 50, payments: [{ method: 'Cash', amount: 50 }] } });
    const res = await post(`/api/client/orders/${id}/cancel`, clientATok);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/refund/i);
    expect((await Order.findById(id).lean()).status).toBe('Pending');
  });

  it('DATA ISOLATION: client B cannot cancel client A\'s order', async () => {
    const placed = await post('/api/orders', clientATok, orderBody(1));
    const res = await post(`/api/client/orders/${placed.body.order._id}/cancel`, clientBTok);
    expect(res.status).toBe(404);
  });
});

describe('client portal: a client changes their own reserved order', () => {
  const reserve = async (qty = 2) => {
    const placed = await post('/api/orders', clientATok, orderBody(qty));
    const id = placed.body.order._id;
    const r = await request(app).put(`/api/orders/${id}`).set('Authorization', `Bearer ${superTok}`).send({ status: 'Reserved' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return id;
  };

  it('changes the quantity, re-priced, marked as edited by the client and audited', async () => {
    const id = await reserve(2);
    const res = await post(`/api/client/orders/${id}/edit`, clientATok, { changes: [{ index: 0, quantity: 5, price: 1 }] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const o = await mongoose.model('Order').findById(id).lean();
    expect(o.items[0].quantity).toBe(5);
    expect(o.items[0].price).toBe(100); // the client cannot set a price
    expect(o.total).toBe(500);
    expect(o.editedByClientAt).toBeTruthy();
    expect(await mongoose.model('AuditLog').exists({ action: 'Order_CLIENT_EDIT', targetReference: String(id) })).toBeTruthy();
  });

  it('refuses once the order is paid, or is not reserved', async () => {
    const id = await reserve(1);
    await mongoose.model('Order').updateOne({ _id: id }, { $set: { amountPaid: 10 } });
    const r1 = await post(`/api/client/orders/${id}/edit`, clientATok, { changes: [{ index: 0, quantity: 3 }] });
    expect(r1.status).toBe(409);
    expect(r1.body.error).toMatch(/contact us/i);
    const pending = (await post('/api/orders', clientATok, orderBody(1))).body.order._id;
    const r2 = await post(`/api/client/orders/${pending}/edit`, clientATok, { changes: [{ index: 0, quantity: 3 }] });
    expect(r2.status).toBe(409);
  });

  it('adds a product, priced from the catalogue', async () => {
    const id = await reserve(1);
    const crate = await mongoose.model('Product').create({ name: 'Crate', category: 'Freight', basePrice: 40 });
    const res = await post(`/api/client/orders/${id}/edit`, clientATok, { adds: [{ productId: String(crate._id), quantity: 2 }] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const o = await mongoose.model('Order').findById(id).lean();
    expect(o.items.find(i => i.name.toUpperCase() === 'CRATE')).toMatchObject({ quantity: 2, price: 40 });
    expect(o.total).toBe(180);
  });

  it('another client cannot change it', async () => {
    const id = await reserve(1);
    const r = await post(`/api/client/orders/${id}/edit`, clientBTok, { changes: [{ index: 0, quantity: 3 }] });
    expect(r.status).toBe(404);
  });

  it('a client can cancel an unpaid reserved order', async () => {
    const id = await reserve(1);
    const r = await post(`/api/client/orders/${id}/cancel`, clientATok);
    expect(r.status).toBe(200);
    expect(await mongoose.model('Order').findById(id).lean()).toMatchObject({ status: 'Cancelled', cancelledByClient: true });
  });
});
