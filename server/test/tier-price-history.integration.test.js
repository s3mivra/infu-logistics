// "As of [date]: price" history for Market Segment Pricing - the tier-side
// counterpart to /api/products/:id/price-history. A per_product tier logs one
// entry per changed product row (TIER_PRICE_CHANGED); a percent tier logs one
// entry per rate change on the tier itself (TIER_PERCENT_CHANGED).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, superTok, staffTok, cat;
const auth = (m, p, t) => request(app)[m](p).set('Authorization', `Bearer ${t}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'tphSuper', role: 'superadmin' });
  await makeUser({ name: 'tphStaff', role: 'staff' });
  superTok = await loginStaff(app, 'tphSuper');
  staffTok = await loginStaff(app, 'tphStaff');
  cat = await mongoose.model('Category').create({ name: 'TphCat', department: 'Logistics' });
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('GET /api/price-tiers/:id/history - per_product tier, one product', () => {
  it('logs nothing on the first save (no prior price to compare against is still a change from unset, so it DOES log - null -> price)', async () => {
    const tier = await mongoose.model('PriceTier').create({ name: 'TphA', pricingMode: 'per_product' });
    const prod = await mongoose.model('Product').create({ name: 'TphProd A', category: 'TphCat', basePrice: 500 });
    await auth('put', `/api/price-tiers/${tier._id}/products`, superTok).send({ prices: [{ productId: prod._id, price: 400 }] });

    const res = await auth('get', `/api/price-tiers/${tier._id}/history?productId=${prod._id}`, staffTok);
    expect(res.status).toBe(200);
    expect(res.body.history).toHaveLength(1);
    expect(res.body.history[0].oldValue).toBeNull();
    expect(res.body.history[0].newValue).toBe(400);
    expect(res.body.history[0].type).toBe('price');
  });

  it('logs a new entry each time the price actually changes, newest first', async () => {
    const tier = await mongoose.model('PriceTier').create({ name: 'TphB', pricingMode: 'per_product' });
    const prod = await mongoose.model('Product').create({ name: 'TphProd B', category: 'TphCat', basePrice: 500 });
    await auth('put', `/api/price-tiers/${tier._id}/products`, superTok).send({ prices: [{ productId: prod._id, price: 400 }] });
    await auth('put', `/api/price-tiers/${tier._id}/products`, superTok).send({ prices: [{ productId: prod._id, price: 350 }] });

    const res = await auth('get', `/api/price-tiers/${tier._id}/history?productId=${prod._id}`, staffTok);
    expect(res.body.history).toHaveLength(2);
    expect(res.body.history[0].oldValue).toBe(400);
    expect(res.body.history[0].newValue).toBe(350);
    expect(res.body.history[1].oldValue).toBeNull();
    expect(res.body.history[1].newValue).toBe(400);
  });

  it('re-saving the same price logs nothing new', async () => {
    const tier = await mongoose.model('PriceTier').create({ name: 'TphC', pricingMode: 'per_product' });
    const prod = await mongoose.model('Product').create({ name: 'TphProd C', category: 'TphCat', basePrice: 500 });
    await auth('put', `/api/price-tiers/${tier._id}/products`, superTok).send({ prices: [{ productId: prod._id, price: 400 }] });
    await auth('put', `/api/price-tiers/${tier._id}/products`, superTok).send({ prices: [{ productId: prod._id, price: 400 }] });

    const res = await auth('get', `/api/price-tiers/${tier._id}/history?productId=${prod._id}`, staffTok);
    expect(res.body.history).toHaveLength(1);
  });

  it('removing a product from the sheet logs oldPrice -> null', async () => {
    const tier = await mongoose.model('PriceTier').create({ name: 'TphD', pricingMode: 'per_product' });
    const prod = await mongoose.model('Product').create({ name: 'TphProd D', category: 'TphCat', basePrice: 500 });
    await auth('put', `/api/price-tiers/${tier._id}/products`, superTok).send({ prices: [{ productId: prod._id, price: 400 }] });
    await auth('put', `/api/price-tiers/${tier._id}/products`, superTok).send({ prices: [] });

    const res = await auth('get', `/api/price-tiers/${tier._id}/history?productId=${prod._id}`, staffTok);
    expect(res.body.history).toHaveLength(2);
    expect(res.body.history[0].oldValue).toBe(400);
    expect(res.body.history[0].newValue).toBeNull();
  });

  it('a different product on the same tier has an independent history', async () => {
    const tier = await mongoose.model('PriceTier').create({ name: 'TphE', pricingMode: 'per_product' });
    const prodX = await mongoose.model('Product').create({ name: 'TphProd E1', category: 'TphCat', basePrice: 500 });
    const prodY = await mongoose.model('Product').create({ name: 'TphProd E2', category: 'TphCat', basePrice: 500 });
    await auth('put', `/api/price-tiers/${tier._id}/products`, superTok).send({ prices: [{ productId: prodX._id, price: 400 }, { productId: prodY._id, price: 300 }] });

    const resX = await auth('get', `/api/price-tiers/${tier._id}/history?productId=${prodX._id}`, staffTok);
    const resY = await auth('get', `/api/price-tiers/${tier._id}/history?productId=${prodY._id}`, staffTok);
    expect(resX.body.history).toHaveLength(1);
    expect(resX.body.history[0].newValue).toBe(400);
    expect(resY.body.history).toHaveLength(1);
    expect(resY.body.history[0].newValue).toBe(300);
  });
});

describe('GET /api/price-tiers/:id/history - percent tier, tier-wide', () => {
  it('logs the shared rate change once per save', async () => {
    const tier = await mongoose.model('PriceTier').create({ name: 'TphF', pricingMode: 'percent', percent: 10 });
    await auth('put', `/api/price-tiers/${tier._id}`, superTok).send({ percent: 15 });
    await auth('put', `/api/price-tiers/${tier._id}`, superTok).send({ percent: 20 });

    const res = await auth('get', `/api/price-tiers/${tier._id}/history`, staffTok);
    expect(res.body.history).toHaveLength(2);
    expect(res.body.history[0].oldValue).toBe(15);
    expect(res.body.history[0].newValue).toBe(20);
    expect(res.body.history[1].oldValue).toBe(10);
    expect(res.body.history[1].newValue).toBe(15);
  });

  it('re-saving the tier without changing percent logs nothing new', async () => {
    const tier = await mongoose.model('PriceTier').create({ name: 'TphG', pricingMode: 'percent', percent: 10 });
    await auth('put', `/api/price-tiers/${tier._id}`, superTok).send({ note: 'just a note edit' });

    const res = await auth('get', `/api/price-tiers/${tier._id}/history`, staffTok);
    expect(res.body.history).toHaveLength(0);
  });
});
