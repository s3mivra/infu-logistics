// The price-tier Excel round trip (download/edit/re-import) is driven
// entirely from the client against the existing tier endpoints - see
// exportPriceTiersExcel / parsePriceTierExcel / submitPriceTierImport in
// AdminDashboard.jsx. These tests exercise the underlying server contract
// that flow depends on: the pricing-table export shape, the merge-not-replace
// semantics of a partial price update, and the percent -> per_product switch
// a bulk import triggers.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, superTok;
const auth = (m, p, t) => request(app)[m](p).set('Authorization', `Bearer ${t}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'ptiSuper', role: 'superadmin' });
  superTok = await loginStaff(app, 'ptiSuper');
  await mongoose.model('Category').create({ name: 'PtiCat', department: 'Logistics' });
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('pricing-table carries what the Excel export needs', () => {
  it('includes productCode - the authoritative match key for re-import', async () => {
    const prod = await mongoose.model('Product').create({
      name: 'Coded Widget', category: 'PtiCat', basePrice: 100, productCode: 'PTI-001',
    });
    const res = await auth('get', '/api/price-tiers/pricing-table', superTok);
    expect(res.status).toBe(200);
    const row = res.body.products.find(p => String(p._id) === String(prod._id));
    expect(row.productCode).toBe('PTI-001');
  });

  it('a per_product tier with no rate for a product reports null, not 0 - so the exported cell is blank', async () => {
    const created = await auth('post', '/api/price-tiers', superTok)
      .send({ name: 'Blank Cell Tier', pricingMode: 'per_product' });
    const tierId = created.body.tier._id;

    const prod = await mongoose.model('Product').create({ name: 'Unpriced Widget', category: 'PtiCat', basePrice: 80 });
    const res = await auth('get', '/api/price-tiers/pricing-table', superTok);
    const tierRow = res.body.tiers.find(t => t._id === tierId);
    expect(tierRow.prices[String(prod._id)]).toBeNull();
  });
});

describe('re-importing a tier merges onto its existing prices, never replaces blind', () => {
  it('a price set for product A survives an import that only touches product B', async () => {
    const created = await auth('post', '/api/price-tiers', superTok)
      .send({ name: 'Merge Tier', pricingMode: 'per_product' });
    const tierId = created.body.tier._id;

    const a = await mongoose.model('Product').create({ name: 'Merge A', category: 'PtiCat', basePrice: 100 });
    const b = await mongoose.model('Product').create({ name: 'Merge B', category: 'PtiCat', basePrice: 200 });

    // First set A (simulates an earlier edit / earlier import).
    await auth('put', `/api/price-tiers/${tierId}/products`, superTok)
      .send({ prices: [{ productId: a._id, price: 90 }] });

    // The client's import flow reads the CURRENT prices, adds B, and PUTs the
    // union - this is the same merge shape handleTierCellUpdate uses for one
    // cell, applied here to simulate a bulk import touching just B.
    const before = await auth('get', '/api/price-tiers/pricing-table', superTok);
    const tierRow = before.body.tiers.find(t => t._id === tierId);
    const merged = Object.entries(tierRow.prices)
      .filter(([, v]) => v !== null)
      .map(([productId, price]) => ({ productId, price }));
    merged.push({ productId: b._id, price: 190 });

    const applied = await auth('put', `/api/price-tiers/${tierId}/products`, superTok).send({ prices: merged });
    expect(applied.status).toBe(200);

    const after = await auth('get', '/api/price-tiers/pricing-table', superTok);
    const afterRow = after.body.tiers.find(t => t._id === tierId);
    expect(afterRow.prices[String(a._id)]).toBe(90);   // untouched by the B-only import
    expect(afterRow.prices[String(b._id)]).toBe(190);
  });
});

describe('importing prices into a percent-mode tier requires switching its mode first', () => {
  it('prices written to a percent tier without switching modes are silently ignored', async () => {
    const created = await auth('post', '/api/price-tiers', superTok)
      .send({ name: 'Still Percent', pricingMode: 'percent', percent: 10 });
    const tierId = created.body.tier._id;
    const prod = await mongoose.model('Product').create({ name: 'Percent Widget', category: 'PtiCat', basePrice: 100 });

    await auth('put', `/api/price-tiers/${tierId}/products`, superTok)
      .send({ prices: [{ productId: prod._id, price: 42 }] });

    // resolveTierPrice ignores productPrices entirely while pricingMode is
    // 'percent' - this is exactly why the import flow switches mode FIRST.
    const res = await auth('get', '/api/price-tiers/pricing-table', superTok);
    const row = res.body.tiers.find(t => t._id === tierId);
    expect(row.prices[String(prod._id)]).toBe(90);   // 10% off 100, not 42
  });

  it('switching pricingMode to per_product makes the same stored price take effect', async () => {
    const created = await auth('post', '/api/price-tiers', superTok)
      .send({ name: 'Switching Tier', pricingMode: 'percent', percent: 15 });
    const tierId = created.body.tier._id;
    const prod = await mongoose.model('Product').create({ name: 'Switch Widget', category: 'PtiCat', basePrice: 100 });

    await auth('put', `/api/price-tiers/${tierId}/products`, superTok)
      .send({ prices: [{ productId: prod._id, price: 55 }] });
    // Import's second step: flip the mode.
    const switched = await auth('put', `/api/price-tiers/${tierId}`, superTok)
      .send({ pricingMode: 'per_product' });
    expect(switched.status).toBe(200);

    const res = await auth('get', '/api/price-tiers/pricing-table', superTok);
    const row = res.body.tiers.find(t => t._id === tierId);
    expect(row.prices[String(prod._id)]).toBe(55);
    expect(row.pricingMode).toBe('per_product');
  });
});

describe('a new tier name from an unrecognized column can be created outright', () => {
  it('a fresh tier starts in per_product mode with the imported prices in place', async () => {
    const created = await auth('post', '/api/price-tiers', superTok)
      .send({ name: 'Brand New Column', pricingMode: 'per_product' });
    expect(created.status).toBe(200);
    expect(created.body.tier.pricingMode).toBe('per_product');

    const prod = await mongoose.model('Product').create({ name: 'New Column Widget', category: 'PtiCat', basePrice: 50 });
    await auth('put', `/api/price-tiers/${created.body.tier._id}/products`, superTok)
      .send({ prices: [{ productId: prod._id, price: 45 }] });

    const list = await auth('get', '/api/price-tiers', superTok);
    const tier = list.body.tiers.find(t => t.name === 'Brand New Column');
    expect(tier.productPrices.some(pp => String(pp.productId) === String(prod._id) && pp.price === 45)).toBe(true);
  });
});
