// Two things a Philippine business is asked for that the system did not hold.
//
// 1. An SC/PWD discount is granted against a named cardholder's ID - both the
//    20% and the VAT exemption hang off it. The system applied the discount
//    but recorded nobody, which is the discount an examiner disallows. The
//    details are now required before the sale can complete: at the counter,
//    while the customer is still there.
// 2. A supplier's TIN and registered name are what a 2307 is made out to and
//    what substantiates input VAT claimed on their invoice.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok, product;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const M = (n) => mongoose.model(n);

// A sale carrying an order-level SC/PWD discount.
const scPwdSale = async () => {
  const res = await auth('post', '/api/orders').send({
    table: 'Takeout', paymentMethod: 'Cash', isVatExempt: true, discountPercent: 20,
    items: [{ productId: String(product._id), name: 'Meal', price: 100, quantity: 1 }],
  });
  expect(res.body.order.discountType).toBe('SC/PWD');
  return res.body.order;
};

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'ScPwdSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'ScPwdSuper');
  await M('Category').create({ name: 'Food' });
  product = await M('Product').create({ name: 'Meal', category: 'Food', basePrice: 100 });
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('an SC/PWD discount needs a cardholder', () => {
  it('refuses to complete the sale until the name and ID are on it', async () => {
    const order = await scPwdSale();
    const blocked = await auth('put', `/api/orders/${order._id}`).send({ status: 'Completed' });
    expect(blocked.status).toBe(400);
    expect(blocked.body.needsScPwdId).toBe(true);
    expect(blocked.body.error).toMatch(/cardholder/i);
    expect((await M('Order').findById(order._id).lean()).status).not.toBe('Completed');
  }, 30000);

  it('completes once they are recorded, and keeps them on the sale', async () => {
    const order = await scPwdSale();
    const saved = await auth('put', `/api/orders/${order._id}`).send({
      scPwdName: 'Maria Santos', scPwdIdNumber: 'SC-2019-004412', scPwdKind: 'Senior Citizen',
    });
    expect(saved.body.success).toBe(true);

    const done = await auth('put', `/api/orders/${order._id}`).send({ status: 'Completed' });
    expect(done.body.success).toBe(true);

    const fresh = await M('Order').findById(order._id).lean();
    expect(fresh).toMatchObject({
      status: 'Completed', scPwdName: 'Maria Santos',
      scPwdIdNumber: 'SC-2019-004412', scPwdKind: 'Senior Citizen',
    });
  }, 30000);

  it('leaves an ordinary sale alone', async () => {
    const res = await auth('post', '/api/orders').send({
      table: 'Takeout', paymentMethod: 'Cash',
      items: [{ productId: String(product._id), name: 'Meal', price: 100, quantity: 1 }],
    });
    const done = await auth('put', `/api/orders/${res.body.order._id}`).send({ status: 'Completed' });
    expect(done.body.success).toBe(true);
    const fresh = await M('Order').findById(res.body.order._id).lean();
    expect(fresh.scPwdName).toBe('');
  }, 30000);
});

describe('supplier tax details', () => {
  it('stores the TIN, registered name and VAT status, and lets them be edited', async () => {
    const created = await auth('post', '/api/suppliers').send({
      name: 'Metro Supply', tin: '005-123-456-00000',
      registeredName: 'METRO SUPPLY TRADING INC.', isVatRegistered: true,
    });
    expect(created.status).toBe(201);
    expect(created.body.supplier).toMatchObject({
      tin: '005-123-456-00000',
      registeredName: 'METRO SUPPLY TRADING INC.',
      isVatRegistered: true,
    });

    const patched = await auth('patch', `/api/suppliers/${created.body.supplier._id}`)
      .send({ tin: '005-999-888-00000', isVatRegistered: false });
    expect(patched.status).toBe(200);
    const fresh = await M('Supplier').findById(created.body.supplier._id).lean();
    expect(fresh.tin).toBe('005-999-888-00000');
    expect(fresh.isVatRegistered).toBe(false);
  }, 30000);

  it('defaults to no TIN and not VAT-registered', async () => {
    const res = await auth('post', '/api/suppliers').send({ name: 'Corner Store' });
    expect(res.body.supplier.tin).toBe('');
    expect(res.body.supplier.isVatRegistered).toBe(false);
  }, 30000);
});
