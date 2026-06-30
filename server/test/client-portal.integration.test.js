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
    expect(o.billingNumber).toMatch(/^\d{4}-\d{2}-\d{4}$/); // logistics monthly billing ref
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
    expect(res.status).toBe(404); // ownership filter — not B's order
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
});
