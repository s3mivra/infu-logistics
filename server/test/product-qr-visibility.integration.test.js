// Café products that are counter-only: sold at the POS, never on the table QR.
//
// Hiding a product from the QR menu has to hold at both ends - the menu never
// lists it, and a QR order carrying it (a saved page, an edited request) is
// refused without costing the customer their session.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, boss, staff, latte, cake;
const M = (n) => mongoose.model(n);
const as = (tok) => (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const qrMenuNames = async () => (await request(app).get('/api/products')).body.products.map((p) => p.name);
const posNames = async () => (await as(boss)('get', '/api/products')).body.products.map((p) => p.name);
const newQrSession = async () => {
  const s = await as(boss)('post', '/api/sessions/generate').send({ table: `T-${Math.random().toString(36).slice(2, 7)}` });
  return s.body;
};
const qrOrder = (sess, product) => request(app).post('/api/orders').send({
  table: sess.table, sessionId: sess.sessionId, customerName: 'Guest Ana',
  items: [{ productId: String(product._id), name: product.name, price: product.basePrice, quantity: 1 }],
});

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'QrVisBoss', role: 'superadmin' });
  await makeUser({ name: 'QrVisStaff', role: 'staff' });
  boss = await loginStaff(app, 'QrVisBoss');
  staff = await loginStaff(app, 'QrVisStaff');
}, 120000);
afterAll(async () => { await ctx.stop(); });
beforeEach(async () => {
  await M('Product').deleteMany({});
  latte = await M('Product').create({ name: 'Latte', category: 'Coffee', basePrice: 130 });
  cake = await M('Product').create({ name: 'Whole Cake', category: 'Pastry', basePrice: 900, showOnQr: false });
});

describe('counter-only products', () => {
  it('are on the POS but not on the QR menu; products are on both by default', async () => {
    expect(latte.showOnQr).toBe(true);
    expect(await qrMenuNames()).toEqual(['Latte']);
    expect((await posNames()).sort()).toEqual(['Latte', 'Whole Cake']);
  });

  it('cannot be ordered from a QR code, and the session survives the refusal', async () => {
    const sess = await newQrSession();
    const refused = await qrOrder(sess, cake);
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/Whole Cake can only be ordered at the counter/);
    // Same session, fixed cart: it goes through.
    const ok = await qrOrder(sess, latte);
    expect(ok.body.success).toBe(true);
  });

  it('can still be sold at the POS', async () => {
    const res = await as(boss)('post', '/api/orders').send({
      table: 'Counter', paymentMethod: 'Cash', customerName: 'Walk-in',
      items: [{ productId: String(cake._id), name: 'Whole Cake', price: 900, quantity: 1 }],
    });
    expect(res.body.success).toBe(true);
  });
});

describe('the switch', () => {
  it('moves a product onto and off the QR menu', async () => {
    let res = await as(boss)('patch', `/api/products/${cake._id}/qr`).send({ showOnQr: true });
    expect(res.body.success).toBe(true);
    expect((await qrMenuNames()).sort()).toEqual(['Latte', 'Whole Cake']);

    res = await as(boss)('patch', `/api/products/${latte._id}/qr`).send({ showOnQr: false });
    expect(res.body.product.showOnQr).toBe(false);
    expect(await qrMenuNames()).toEqual(['Whole Cake']);
    expect(await M('AuditLog').countDocuments({ action: 'PRODUCT_HIDDEN_FROM_QR' })).toBeGreaterThan(0);
  });

  it('is saved from the product form too', async () => {
    const res = await as(boss)('post', '/api/products').send({ name: 'Staff Meal', category: 'Kitchen', basePrice: 80, showOnQr: false });
    expect(res.body.product.showOnQr).toBe(false);
    await as(boss)('put', `/api/products/${res.body.product._id}`).send({ showOnQr: true });
    expect((await M('Product').findById(res.body.product._id).lean()).showOnQr).toBe(true);
  });

  it('needs products.manage, and a real true/false', async () => {
    expect((await as(staff)('patch', `/api/products/${latte._id}/qr`).send({ showOnQr: false })).status).toBe(403);
    expect((await request(app).patch(`/api/products/${latte._id}/qr`).send({ showOnQr: false })).status).toBe(401);
    expect((await as(boss)('patch', `/api/products/${latte._id}/qr`).send({ showOnQr: 'no' })).status).toBe(400);
    expect((await as(boss)('patch', '/api/products/not-an-id/qr').send({ showOnQr: false })).status).toBe(404);
  });
});
