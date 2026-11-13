// Manual Order's price tier picker: SRP (list price) unless a tier is picked;
// a picked tier prices the sale exactly as it would for a client in that tier,
// needs pricing.tiers / orders.override or a manager's PIN, and is recorded.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, superTok, cashierTok, pricerTok, prod;
const M = (n) => mongoose.model(n);
const auth = (method, path, tok) => request(app)[method](path).set('Authorization', `Bearer ${tok}`);
const line = () => [{ productId: String(prod._id), name: prod.name, price: 1000, quantity: 2 }];

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'TpOwner', role: 'superadmin' });
  await makeUser({ name: 'TpCashier', role: 'staff', permissions: ['pos.use', 'orders.view', 'orders.manage'] });
  await makeUser({ name: 'TpPricer', role: 'staff', permissions: ['pos.use', 'orders.view', 'orders.manage', 'pricing.tiers'] });
  superTok = await loginStaff(app, 'TpOwner');
  cashierTok = await loginStaff(app, 'TpCashier');
  pricerTok = await loginStaff(app, 'TpPricer');
  await M('Category').create({ name: 'TpCat', department: 'Logistics' });
  prod = await M('Product').create({ name: 'Tier Picker Item', category: 'TpCat', basePrice: 1000 });
  const tier = await M('PriceTier').create({ name: 'Dealer', pricingMode: 'per_product', percent: 0 });
  await auth('put', `/api/price-tiers/${tier._id}/products`, superTok).send({ prices: [{ productId: prod._id, price: 800 }] });
  await M('PriceTier').create({ name: 'Old Tier', pricingMode: 'percent', percent: 50, isActive: false });
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('manual order price tier', () => {
  it('no tier picked is SRP: the list price', async () => {
    const res = await auth('post', '/api/orders', cashierTok).send({ items: line(), table: 'Walk In', paymentMethod: 'Cash' });
    expect(res.status).toBe(200);
    expect(res.body.order.total).toBeCloseTo(2000, 2);
    expect(res.body.order.priceTier || '').toBe('');
  });

  it('a picked tier prices the sale at that tier, and the order says which', async () => {
    const res = await auth('post', '/api/orders', pricerTok).send({ items: line(), table: 'Walk In', paymentMethod: 'Cash', priceTier: 'dealer' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.order.total).toBeCloseTo(1600, 2);
    expect(res.body.order.priceTier).toBe('Dealer');
  });

  it('a cashier without tier rights is asked for a manager\'s approval', async () => {
    const res = await auth('post', '/api/orders', cashierTok).send({ items: line(), table: 'Walk In', paymentMethod: 'Cash', priceTier: 'Dealer' });
    expect(res.status).toBe(403);
    expect(res.body.needsApproval).toBe('orders.override');
    expect(res.body.target).toBe('tier:Dealer');
  });

  it('an unknown or switched-off tier is refused', async () => {
    for (const priceTier of ['Nonexistent', 'Old Tier']) {
      const res = await auth('post', '/api/orders', pricerTok).send({ items: line(), table: 'Walk In', paymentMethod: 'Cash', priceTier });
      expect(res.status, priceTier).toBe(400);
    }
  });

  it('the catalogue previews the tier for staff, and ignores it for anyone else', async () => {
    const staff = await auth('get', '/api/products?priceTier=Dealer', cashierTok);
    const row = staff.body.products.find((p) => p.name === 'Tier Picker Item');
    expect(row.buyerUnitPrice).toBe(800);
    const anon = await request(app).get('/api/products?priceTier=Dealer');
    const anonRow = (anon.body.products || anon.body).find((p) => p.name === 'Tier Picker Item');
    expect(anonRow.buyerUnitPrice).toBeUndefined();
  });
});
