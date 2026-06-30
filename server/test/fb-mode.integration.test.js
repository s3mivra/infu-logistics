// fb-mode (food & beverage / QR) coverage. BUSINESS_TYPE is read once at server load, so
// fb behaviour gets its own file/process. Verifies the app's core money/stock flow works
// in fb, that billing numbers now generate in fb too (the "make same" change), and the
// product-image toggle.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, staffTok, superTok, prod, inv;
let orderId;

const order = (qty = 1) =>
  request(app).post('/api/orders').set('Authorization', `Bearer ${staffTok}`)
    .send({ items: [{ productId: String(prod._id), name: 'FB Latte', price: 100, quantity: qty }], table: 'Takeout', paymentMethod: 'Cash' });

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'fb_super', role: 'superadmin' });
  await makeUser({ name: 'fb_staff', role: 'staff' });
  superTok = await loginStaff(app, 'fb_super');
  staffTok = await loginStaff(app, 'fb_staff');

  const Inventory = mongoose.model('Inventory');
  const Product = mongoose.model('Product');
  await mongoose.model('Category').create({ name: 'FBcat', department: 'Kitchen' });
  inv = await Inventory.create({ itemName: 'FB Bean', stockQty: 1000, unit: 'g', unitCost: 0.5 });
  prod = await Product.create({
    name: 'FB Latte', category: 'FBcat', basePrice: 100, image: 'http://example.com/latte.png',
    baseRecipe: [{ invId: String(inv._id), name: 'FB Bean', qty: 5, cost: 2.5, unit: 'g' }],
  });
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('fb mode: core order flow', () => {
  it('order creation generates a billing number (now both business types)', async () => {
    const res = await order(1);
    expect(res.status).toBe(200);
    expect(res.body.order.billingNumber).toMatch(/^\d{4}-\d{2}-\d{4}$/);
    orderId = res.body.order._id;
  });

  it('completing the order deducts stock and posts a balanced sale entry', async () => {
    const Inventory = mongoose.model('Inventory');
    const before = (await Inventory.findById(inv._id).lean()).stockQty;
    const res = await request(app).put(`/api/orders/${orderId}`).set('Authorization', `Bearer ${staffTok}`).send({ status: 'Completed' });
    expect(res.status).toBe(200);
    expect(before - (await Inventory.findById(inv._id).lean()).stockQty).toBe(5);
    const je = await mongoose.model('JournalEntry').findOne({ 'lines.accountCode': '410000' }).sort({ createdAt: -1 }).lean();
    expect(je.totalDebit).toBeCloseTo(je.totalCredit, 6);
  });

  it('percentage-tax report works in fb mode', async () => {
    const res = await request(app).get('/api/reports/percentage-tax?start=2000-01-01&end=2100-01-01').set('Authorization', `Bearer ${superTok}`);
    expect(res.status).toBe(200);
    expect(res.body.netCollected).toBeGreaterThan(0);
  });
});

describe('fb mode: product images toggle', () => {
  it('disabling images strips them for customers but keeps them for staff', async () => {
    const off = await request(app).patch('/api/settings/imagesEnabled').set('Authorization', `Bearer ${superTok}`).send({ value: false });
    expect(off.status).toBe(200);

    const customer = await request(app).get('/api/products'); // no token → customer
    expect(customer.body.products.find(p => p.name === 'FB Latte').image).toBe('');

    const staff = await request(app).get('/api/products').set('Authorization', `Bearer ${staffTok}`);
    expect(staff.body.products.find(p => p.name === 'FB Latte').image).toBe('http://example.com/latte.png');

    await request(app).patch('/api/settings/imagesEnabled').set('Authorization', `Bearer ${superTok}`).send({ value: true });
    const reEnabled = await request(app).get('/api/products');
    expect(reEnabled.body.products.find(p => p.name === 'FB Latte').image).toBe('http://example.com/latte.png');
  });
});
