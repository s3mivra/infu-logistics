// GET /api/products resolves effectiveDiscountPercent for the caller. This is
// the SAME endpoint both the client portal menu and the POS product list read
// from, and it must resolve discounts through the identical precedence
// orders.js uses at checkout (lib/discounts.js) - otherwise a buyer sees one
// price and gets charged another.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { bootApp, makeUser, makeClient, loginStaff, loginClient } from './helpers/harness.js';

let ctx, app, superTok, staffTok;
const auth = (method, path, token) => request(app)[method](path).set('Authorization', `Bearer ${token}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'ptpSuper', role: 'superadmin' });
  await makeUser({ name: 'ptpStaff', role: 'staff' });
  superTok = await loginStaff(app, 'ptpSuper');
  staffTok = await loginStaff(app, 'ptpStaff');
}, 120000);

afterAll(async () => { await ctx.stop(); });

async function makeTaggedClient(username, segments) {
  await makeClient({ username, password: 'pw' });
  await mongoose.model('ClientAccount').updateOne({ username }, { $set: { segments } });
  return loginClient(app, username, 'pw');
}

describe('GET /api/products resolves the SAME discount an order would charge', () => {
  it('an anonymous caller sees only the flat product default', async () => {
    const prod = await mongoose.model('Product').create({ name: 'PTP Flat Product', category: 'PTP-Cat', basePrice: 100, discountPercent: 10 });
    const res = await request(app).get('/api/products');
    expect(res.status).toBe(200);
    const row = res.body.products.find(p => p._id === String(prod._id));
    expect(row.effectiveDiscountPercent).toBe(10);
  });

  it('a client tagged with a percent-mode tier sees the tier rate, not just the flat default', async () => {
    await auth('post', '/api/price-tiers', superTok).send({ name: 'PTP Dealer', percent: 15 });
    const prod = await mongoose.model('Product').create({ name: 'PTP Tier Product', category: 'PTP-Cat', basePrice: 200, discountPercent: 5 });
    const tok = await makeTaggedClient('ptp_dealer', ['PTP Dealer']);

    const res = await auth('get', '/api/products', tok);
    expect(res.status).toBe(200);
    const row = res.body.products.find(p => p._id === String(prod._id));
    expect(row.effectiveDiscountPercent).toBe(15); // tier beats the flat 5%
  });

  it('a client tagged with a per_product tier sees the equivalent percent for a listed SKU', async () => {
    const made = await auth('post', '/api/price-tiers', superTok).send({ name: 'PTP Wholesaler', pricingMode: 'per_product' });
    const prod = await mongoose.model('Product').create({ name: 'PTP PP Product', category: 'PTP-Cat', basePrice: 200 });
    await auth('put', `/api/price-tiers/${made.body.tier._id}/products`, superTok).send({ prices: [{ productId: String(prod._id), price: 150 }] });
    const tok = await makeTaggedClient('ptp_wholesale', ['PTP Wholesaler']);

    const res = await auth('get', '/api/products', tok);
    const row = res.body.products.find(p => p._id === String(prod._id));
    expect(row.effectiveDiscountPercent).toBe(25); // 150/200 -> 25% off
  });

  it('a per_product tier grants nothing on a SKU it has no row for', async () => {
    const made = await auth('post', '/api/price-tiers', superTok).send({ name: 'PTP Listed Only', pricingMode: 'per_product' });
    const listed = await mongoose.model('Product').create({ name: 'PTP Listed', category: 'PTP-Cat', basePrice: 100 });
    const unlisted = await mongoose.model('Product').create({ name: 'PTP Unlisted', category: 'PTP-Cat', basePrice: 100 });
    await auth('put', `/api/price-tiers/${made.body.tier._id}/products`, superTok).send({ prices: [{ productId: String(listed._id), price: 60 }] });
    const tok = await makeTaggedClient('ptp_listedonly', ['PTP Listed Only']);

    const res = await auth('get', '/api/products', tok);
    const listedRow = res.body.products.find(p => p._id === String(listed._id));
    const unlistedRow = res.body.products.find(p => p._id === String(unlisted._id));
    expect(listedRow.effectiveDiscountPercent).toBe(40);
    expect(unlistedRow.effectiveDiscountPercent).toBe(0);
  });

  it('exactly matches what an order for the same buyer/product actually charges', async () => {
    await auth('post', '/api/price-tiers', superTok).send({ name: 'PTP Parity Tier', percent: 12 });
    const prod = await mongoose.model('Product').create({ name: 'PTP Parity Product', category: 'PTP-Cat', basePrice: 250 });
    const client = await mongoose.model('ClientAccount').create({
      clientCode: 'CUS-PTP-1', username: 'ptp_parity', password: await bcrypt.hash('pw', 12),
      name: 'Parity Client', paymentMethod: 'Cash', isActive: true, segments: ['PTP Parity Tier'],
    });
    const tok = await loginClient(app, 'ptp_parity', 'pw');

    const priceRes = await auth('get', '/api/products', tok);
    const row = priceRes.body.products.find(p => p._id === String(prod._id));
    expect(row.effectiveDiscountPercent).toBe(12);

    const orderRes = await auth('post', '/api/orders', staffTok).send({
      items: [{ productId: String(prod._id), name: 'PTP Parity Product', price: 250, quantity: 1 }],
      table: 'Takeout', paymentMethod: 'Cash', clientAccountId: String(client._id),
    });
    expect(orderRes.status).toBe(200);
    expect(orderRes.body.order.total).toBeCloseTo(220, 2); // 250 * (1 - 0.12)
  });

  it('staff can preview a specific client\'s pricing via ?onBehalfClientId, without being that client', async () => {
    await auth('post', '/api/price-tiers', superTok).send({ name: 'PTP Satellite', percent: 8 });
    const prod = await mongoose.model('Product').create({ name: 'PTP Behalf Product', category: 'PTP-Cat', basePrice: 100 });
    const client = await mongoose.model('ClientAccount').create({
      clientCode: 'CUS-PTP-2', username: 'ptp_behalf', password: await bcrypt.hash('pw', 12),
      name: 'Behalf Client', paymentMethod: 'Cash', isActive: true, segments: ['PTP Satellite'],
    });

    const res = await auth('get', `/api/products?onBehalfClientId=${client._id}`, staffTok);
    expect(res.status).toBe(200);
    const row = res.body.products.find(p => p._id === String(prod._id));
    expect(row.effectiveDiscountPercent).toBe(8);
  });

  it('a client cannot use onBehalfClientId to preview a DIFFERENT client\'s pricing', async () => {
    await auth('post', '/api/price-tiers', superTok).send({ name: 'PTP VIP Only', percent: 50 });
    const prod = await mongoose.model('Product').create({ name: 'PTP NoImpersonate Product', category: 'PTP-Cat', basePrice: 100 });
    const vip = await mongoose.model('ClientAccount').create({
      clientCode: 'CUS-PTP-3', username: 'ptp_vip', password: await bcrypt.hash('pw', 12),
      name: 'VIP Client', paymentMethod: 'Cash', isActive: true, segments: ['PTP VIP Only'],
    });
    const plainTok = await makeTaggedClient('ptp_plain', []);

    const res = await auth('get', `/api/products?onBehalfClientId=${vip._id}`, plainTok);
    const row = res.body.products.find(p => p._id === String(prod._id));
    expect(row.effectiveDiscountPercent).toBe(0); // ignored - a client caller isn't staff
  });
});
