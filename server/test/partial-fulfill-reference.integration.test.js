// A partial batch takes real money, so it needs the same evidence a full sale does.
//
// Paying a partial delivery by QR or by check had nowhere to record the
// confirmation number: the route accepted the payment method and dropped the
// reference on the floor. That cash then sat in the books with nothing to
// reconcile it against, which is precisely what the reference exists to
// prevent on the full-sale path.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const M = (n) => mongoose.model(n);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'PartSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'PartSuper');
}, 120000);

afterAll(async () => { await ctx.stop(); });

let product;
beforeEach(async () => {
  for (const n of ['Order', 'Product', 'Category', 'JournalEntry', 'Inventory'].values()) {
    await M(n).deleteMany({});
  }
  await M('Category').create({ name: 'Drinks' });
  product = await M('Product').create({
    productCode: 'P-1', name: 'Latte', category: 'Drinks', basePrice: 100,
  });
});

// Four units ordered, two delivered now.
const openOrder = async () => {
  const res = await auth('post', '/api/orders').send({
    table: 'Takeout', paymentMethod: 'Cash',
    items: [{ productId: String(product._id), name: 'Latte', price: 100, quantity: 4 }],
  });
  return res.body.order;
};

const fulfil = (order, body) => auth('post', `/api/orders/${order._id}/partial-fulfill`)
  .send({ fulfill: [{ index: 0, qty: 2 }], paymentMode: 'partial', ...body });

describe('paying a partial batch by QR', () => {
  it('refuses it with no reference number', async () => {
    const order = await openOrder();
    const res = await fulfil(order, { paymentMethod: 'QR' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reference number is required/i);
  }, 30000);

  it('keeps the reference with the order once given', async () => {
    const order = await openOrder();
    const res = await fulfil(order, { paymentMethod: 'QR', paymentReference: 'GC-889120' });
    expect(res.body.success).toBe(true);

    const fresh = await M('Order').findById(order._id).lean();
    expect(fresh.paymentReference).toBe('GC-889120');
    expect(fresh.status).toBe('Partially Fulfilled');
  }, 30000);

  it('posts nothing at all when the reference is missing', async () => {
    const order = await openOrder();
    const before = await M('JournalEntry').countDocuments({});
    await fulfil(order, { paymentMethod: 'QR' });
    // A refused batch must not half-post: no entry, and no units marked done.
    expect(await M('JournalEntry').countDocuments({})).toBe(before);
    const fresh = await M('Order').findById(order._id).lean();
    expect(fresh.items[0].fulfilledQty || 0).toBe(0);
  }, 30000);
});

describe('paying a partial batch by check', () => {
  it('refuses it without a check number', async () => {
    const order = await openOrder();
    const res = await fulfil(order, { paymentMethod: 'Check' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/check number is required/i);
  }, 30000);

  it('records the check number and the date it can be banked', async () => {
    const order = await openOrder();
    const res = await fulfil(order, {
      paymentMethod: 'Check', paymentReference: '00412', paymentCheckDate: '2026-05-30',
    });
    expect(res.body.success).toBe(true);

    const fresh = await M('Order').findById(order._id).lean();
    expect(fresh.paymentReference).toBe('00412');
    // Post-dated cheques are normal; this is the earliest it can be banked.
    expect(new Date(fresh.paymentCheckDate).getMonth()).toBe(4);
  }, 30000);

  it('refuses a date that is not a date', async () => {
    const order = await openOrder();
    const res = await fulfil(order, {
      paymentMethod: 'Check', paymentReference: '00412', paymentCheckDate: 'next Tuesday',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid check date/i);
  }, 30000);
});

describe('the tenders that carry their own trail', () => {
  it('lets cash through without one', async () => {
    const order = await openOrder();
    const res = await fulfil(order, { paymentMethod: 'Cash' });
    // Cash in a till is counted at close; there is no confirmation number to
    // ask for, and demanding one would block every ordinary sale.
    expect(res.body.success).toBe(true);
  }, 30000);
});
