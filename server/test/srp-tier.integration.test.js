// An SRP tier charges each product its stock item's SRP, read live.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok, prod, plain;
const as = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const M = (n) => mongoose.model(n);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'srpOwner', role: 'superadmin' });
  tok = await loginStaff(app, 'srpOwner');
  await M('Category').create({ name: 'Beans' });
  prod = await M('Product').create({ name: 'House Blend 1kg', category: 'Beans', basePrice: 900, productCode: 'HB1' });
  plain = await M('Product').create({ name: 'Filter Papers', category: 'Beans', basePrice: 80, productCode: 'FP1' });
  await M('Inventory').create({ itemName: 'House Blend 1kg', itemCode: 'HB1', unit: 'pcs', stockQty: 10, srp: 1100 });
}, 120000);
afterAll(async () => { await ctx.stop(); });

describe('SRP tier', () => {
  it('is created, and its price for each product is the SRP; no SRP means no rate', async () => {
    const c = await as('post', '/api/price-tiers').send({ name: 'SRP Price', pricingMode: 'srp' });
    expect(c.body.success, JSON.stringify(c.body)).toBe(true);
    const t = (await as('get', '/api/price-tiers/pricing-table')).body.tiers.find((x) => x.name === 'SRP Price');
    expect(t.pricingMode).toBe('srp');
    expect(t.prices[String(prod._id)]).toBe(1100);
    expect(t.prices[String(plain._id)]).toBeNull();
  });

  it('follows a change to the SRP', async () => {
    await M('Inventory').updateOne({ itemCode: 'HB1' }, { $set: { srp: 1150 } });
    const t = (await as('get', '/api/price-tiers/pricing-table')).body.tiers.find((x) => x.name === 'SRP Price');
    expect(t.prices[String(prod._id)]).toBe(1150);
  });
});
