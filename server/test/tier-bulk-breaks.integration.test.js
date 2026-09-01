// Tier-scoped quantity breaks - the counterpart to Product.clientBulkBreaks
// (one named client) and Product.bulkBreaks (any buyer): "anyone tagged into
// the Kape Sinukuan Price tier who orders 20+ of this product pays ₱550 each."
// Lives on the PriceTier itself (productBulkBreaks), so every client in that
// tier gets it, not just one.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, superTok, staffTok, cat;
const auth = (m, p, t) => request(app)[m](p).set('Authorization', `Bearer ${t}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'tbbSuper', role: 'superadmin' });
  await makeUser({ name: 'tbbStaff', role: 'staff' });
  superTok = await loginStaff(app, 'tbbSuper');
  staffTok = await loginStaff(app, 'tbbStaff');
  cat = await mongoose.model('Category').create({ name: 'TbbCat', department: 'Logistics' });
}, 120000);

afterAll(async () => { await ctx.stop(); });

async function tierWithBreak({ tierName, flatPrice, minQty, breakPrice }) {
  const tier = await mongoose.model('PriceTier').create({
    name: tierName, pricingMode: 'per_product', percent: 0,
  });
  const client = await mongoose.model('ClientAccount').create({
    clientCode: `TBB-${tierName}`, username: `tbb_${tierName.toLowerCase()}`, name: `TBB ${tierName}`,
    password: 'x', paymentMethod: 'Cash', isActive: true, segments: [tierName],
  });
  const prod = await mongoose.model('Product').create({
    name: `TBB Product ${tierName}`, category: 'TbbCat', basePrice: 1000,
  });
  const prices = flatPrice != null ? [{ productId: prod._id, price: flatPrice }] : [];
  const bulkBreaks = minQty != null ? [{ productId: prod._id, minQty, price: breakPrice }] : [];
  await auth('put', `/api/price-tiers/${tier._id}/products`, superTok).send({ prices, bulkBreaks });
  return { tier, client, prod };
}

describe('PUT /api/price-tiers/:id/products with bulkBreaks', () => {
  it('stores breaks independently of the flat price list', async () => {
    const { tier } = await tierWithBreak({ tierName: 'TierA', flatPrice: 900, minQty: 20, breakPrice: 700 });
    const saved = await mongoose.model('PriceTier').findById(tier._id).lean();
    expect(saved.productPrices).toHaveLength(1);
    expect(saved.productBulkBreaks).toHaveLength(1);
    expect(saved.productBulkBreaks[0].minQty).toBe(20);
    expect(saved.productBulkBreaks[0].price).toBe(700);
  });

  it('omitting bulkBreaks from the request leaves existing breaks untouched', async () => {
    const { tier, prod } = await tierWithBreak({ tierName: 'TierB', flatPrice: 900, minQty: 20, breakPrice: 700 });
    // A plain flat-price-only save, as most edits will be.
    await auth('put', `/api/price-tiers/${tier._id}/products`, superTok)
      .send({ prices: [{ productId: prod._id, price: 850 }] });
    const saved = await mongoose.model('PriceTier').findById(tier._id).lean();
    expect(saved.productPrices[0].price).toBe(850);
    expect(saved.productBulkBreaks).toHaveLength(1); // still there
  });

  it('regression: adding a break via bulkBreaks-only (no prices key) must NOT wipe the existing flat price', async () => {
    // This is exactly what the Pricing Control UI's "append" button sends -
    // saveTierBulkBreaks() only ever includes `bulkBreaks` in the body, never
    // `prices`. Before the fix, `prices` defaulted to [] whenever it was
    // omitted (unlike `bulkBreaks`, which stayed untouched when omitted), so
    // a break-only save silently cleared every flat price this tier had.
    const { tier, prod } = await tierWithBreak({ tierName: 'TierBulkOnly', flatPrice: 780, minQty: null, breakPrice: null });
    const saved0 = await mongoose.model('PriceTier').findById(tier._id).lean();
    expect(saved0.productPrices).toHaveLength(1);
    expect(saved0.productPrices[0].price).toBe(780);

    // Add a quantity break the way the UI actually does it - bulkBreaks only.
    const res = await auth('put', `/api/price-tiers/${tier._id}/products`, superTok)
      .send({ bulkBreaks: [{ productId: prod._id, minQty: 20, price: 550 }] });
    expect(res.status).toBe(200);

    const saved = await mongoose.model('PriceTier').findById(tier._id).lean();
    expect(saved.productPrices).toHaveLength(1);        // flat price still there
    expect(saved.productPrices[0].price).toBe(780);       // unchanged
    expect(saved.productBulkBreaks).toHaveLength(1);
    expect(saved.productBulkBreaks[0].minQty).toBe(20);
    expect(saved.productBulkBreaks[0].price).toBe(550);
  });

  it('rejects a break with a non-positive minQty or a negative price', async () => {
    const tier = await mongoose.model('PriceTier').create({ name: 'TierC', pricingMode: 'per_product' });
    const prod = await mongoose.model('Product').create({ name: 'TBB Reject Product', category: 'TbbCat', basePrice: 100 });
    const res = await auth('put', `/api/price-tiers/${tier._id}/products`, superTok)
      .send({ bulkBreaks: [{ productId: prod._id, minQty: 0, price: 90 }, { productId: prod._id, minQty: 10, price: -5 }] });
    expect(res.status).toBe(200);
    const saved = await mongoose.model('PriceTier').findById(tier._id).lean();
    expect(saved.productBulkBreaks).toHaveLength(0); // both rows silently dropped, not stored
  });
});

describe('GET /api/price-tiers/pricing-table', () => {
  it('exposes bulkBreaks per tier, and the flat "prices" map never reflects one (no cart quantity yet)', async () => {
    const { prod } = await tierWithBreak({ tierName: 'TierD', flatPrice: 900, minQty: 20, breakPrice: 700 });
    const res = await auth('get', '/api/price-tiers/pricing-table', superTok);
    const tierRow = res.body.tiers.find(t => t.name === 'TierD');
    expect(tierRow.prices[String(prod._id)]).toBe(900);            // the flat rate, not the break
    expect(tierRow.bulkBreaks).toEqual([{ productId: String(prod._id), minQty: 20, price: 700 }]);
  });
});

describe('order-time resolution: the break only applies once the tier AND the quantity both qualify', () => {
  it('a buyer in the tier who orders enough gets the break price, not the flat one', async () => {
    const { client, prod } = await tierWithBreak({ tierName: 'TierE', flatPrice: 900, minQty: 20, breakPrice: 700 });
    const res = await auth('post', '/api/orders', staffTok).send({
      items: [{ productId: String(prod._id), name: prod.name, price: 1000, quantity: 20 }],
      table: 'Takeout', paymentMethod: 'Cash', clientAccountId: String(client._id),
    });
    expect(res.status).toBe(200);
    // 20 * 700 = 14000, not 20 * 900 = 18000.
    expect(res.body.order.total).toBeCloseTo(14000, 2);
  });

  it('below the quantity threshold, the tier\'s flat rate applies instead', async () => {
    const { client, prod } = await tierWithBreak({ tierName: 'TierF', flatPrice: 900, minQty: 20, breakPrice: 700 });
    const res = await auth('post', '/api/orders', staffTok).send({
      items: [{ productId: String(prod._id), name: prod.name, price: 1000, quantity: 5 }],
      table: 'Takeout', paymentMethod: 'Cash', clientAccountId: String(client._id),
    });
    expect(res.status).toBe(200);
    // 5 * 900 = 4500, the flat tier rate - the break needs 20+.
    expect(res.body.order.total).toBeCloseTo(4500, 2);
  });

  it('a buyer NOT in the tier never sees the break, even at the qualifying quantity', async () => {
    const { prod } = await tierWithBreak({ tierName: 'TierG', flatPrice: 900, minQty: 20, breakPrice: 700 });
    const res = await auth('post', '/api/orders', staffTok).send({
      items: [{ productId: String(prod._id), name: prod.name, price: 1000, quantity: 20 }],
      table: 'Takeout', paymentMethod: 'Cash', // no clientAccountId at all
    });
    expect(res.status).toBe(200);
    // Full list price - nobody outside the tier gets either rate.
    expect(res.body.order.total).toBeCloseTo(20000, 2);
  });

  it('a break with no flat tier price still applies once quantity qualifies', async () => {
    const { client, prod } = await tierWithBreak({ tierName: 'TierH', flatPrice: null, minQty: 15, breakPrice: 800 });
    const res = await auth('post', '/api/orders', staffTok).send({
      items: [{ productId: String(prod._id), name: prod.name, price: 1000, quantity: 15 }],
      table: 'Takeout', paymentMethod: 'Cash', clientAccountId: String(client._id),
    });
    expect(res.status).toBe(200);
    expect(res.body.order.total).toBeCloseTo(12000, 2); // 15 * 800
  });

  it('the better of the tier flat rate and the qualifying break wins, never stacked', async () => {
    // Flat rate (900) happens to already beat the break (950) at this quantity -
    // the buyer should get 900, not some combination of the two.
    const { client, prod } = await tierWithBreak({ tierName: 'TierI', flatPrice: 900, minQty: 20, breakPrice: 950 });
    const res = await auth('post', '/api/orders', staffTok).send({
      items: [{ productId: String(prod._id), name: prod.name, price: 1000, quantity: 25 }],
      table: 'Takeout', paymentMethod: 'Cash', clientAccountId: String(client._id),
    });
    expect(res.status).toBe(200);
    expect(res.body.order.total).toBeCloseTo(22500, 2); // 25 * 900, the better rate
  });
});
