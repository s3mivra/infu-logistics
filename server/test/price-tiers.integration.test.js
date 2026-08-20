// Price tiers - the canonical customer-class registry (Dealer, Satellite, ...)
// behind ClientAccount.segments. Covers the CRUD guards, the rename cascade,
// the in-use delete refusal, and - most importantly - that a tier's default
// percent actually reaches the order money path without a per-product row.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, superTok, staffTok;
const auth = (method, path, token) => request(app)[method](path).set('Authorization', `Bearer ${token}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'ptSuper', role: 'superadmin' });
  await makeUser({ name: 'ptStaff', role: 'staff' });
  superTok = await loginStaff(app, 'ptSuper');
  staffTok = await loginStaff(app, 'ptStaff');
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('price tier registry', () => {
  it('staff can read tiers but only superadmin can create them', async () => {
    const read = await auth('get', '/api/price-tiers', staffTok);
    expect(read.status).toBe(200);
    const blocked = await auth('post', '/api/price-tiers', staffTok).send({ name: 'Nope', percent: 10 });
    expect(blocked.status).toBe(403);
    const ok = await auth('post', '/api/price-tiers', superTok).send({ name: 'Dealer', percent: 15 });
    expect(ok.status).toBe(200);
    expect(ok.body.tier.percent).toBe(15);
  });

  it('refuses a duplicate name differing only in case', async () => {
    // The whole point of the registry: "Dealer" and "dealer" must not coexist,
    // or the exact-match lookup in productDiscPct silently picks neither.
    const dupe = await auth('post', '/api/price-tiers', superTok).send({ name: 'dealer', percent: 30 });
    expect(dupe.status).toBe(400);
    expect(dupe.body.error).toMatch(/already exists/i);
  });

  it('clamps percent into 0-100', async () => {
    const res = await auth('post', '/api/price-tiers', superTok).send({ name: 'Clamped', percent: 500 });
    expect(res.body.tier.percent).toBe(100);
  });
});

describe('price tier default reaches the order money path', () => {
  it('discounts every product for a tagged client with no per-product row', async () => {
    await auth('post', '/api/price-tiers', superTok).send({ name: 'Satellite', percent: 10 });
    const client = await mongoose.model('ClientAccount').create({
      clientCode: 'CUS-PT-1', username: 'pt_satellite', password: 'x',
      name: 'Satellite Buyer', paymentMethod: 'Cash', isActive: true, segments: ['Satellite'],
    });
    // No segmentDiscounts and no flat discountPercent - the tier is the only
    // thing that can move this price.
    const prod = await mongoose.model('Product').create({
      name: 'PT Plain Product', category: 'PT-Cat', basePrice: 200,
    });

    const res = await auth('post', '/api/orders', staffTok).send({
      items: [{ productId: String(prod._id), name: 'PT Plain Product', price: 200, quantity: 1 }],
      table: 'Takeout', paymentMethod: 'Cash', clientAccountId: String(client._id),
    });
    expect(res.status).toBe(200);
    expect(res.body.order.total).toBeCloseTo(180, 2); // 10% off, from the tier alone
  });

  it('matches the tag case-insensitively', async () => {
    // The tag was typed into the old free-text field as "dealer"; the tier is
    // named "Dealer". Before the registry this combination charged full price.
    const client = await mongoose.model('ClientAccount').create({
      clientCode: 'CUS-PT-2', username: 'pt_dealer_lc', password: 'x',
      name: 'Lowercase Dealer', paymentMethod: 'Cash', isActive: true, segments: ['dealer'],
    });
    const prod = await mongoose.model('Product').create({
      name: 'PT Case Product', category: 'PT-Cat', basePrice: 100,
    });
    const res = await auth('post', '/api/orders', staffTok).send({
      items: [{ productId: String(prod._id), name: 'PT Case Product', price: 100, quantity: 1 }],
      table: 'Takeout', paymentMethod: 'Cash', clientAccountId: String(client._id),
    });
    expect(res.status).toBe(200);
    expect(res.body.order.total).toBeCloseTo(85, 2); // Dealer 15%
  });

  it('an explicit per-product segment override beats the tier default', async () => {
    const client = await mongoose.model('ClientAccount').create({
      clientCode: 'CUS-PT-3', username: 'pt_dealer_ov', password: 'x',
      name: 'Override Dealer', paymentMethod: 'Cash', isActive: true, segments: ['Dealer'],
    });
    // Deliberately LOWER than the 15% tier default - a per-product exception
    // must win outright, not be maxed against the tier.
    const prod = await mongoose.model('Product').create({
      name: 'PT Override Product', category: 'PT-Cat', basePrice: 100,
      segmentDiscounts: [{ segment: 'Dealer', percent: 5 }],
    });
    const res = await auth('post', '/api/orders', staffTok).send({
      items: [{ productId: String(prod._id), name: 'PT Override Product', price: 100, quantity: 1 }],
      table: 'Takeout', paymentMethod: 'Cash', clientAccountId: String(client._id),
    });
    expect(res.status).toBe(200);
    expect(res.body.order.total).toBeCloseTo(95, 2);
  });

  it('takes the better of the tier default and the flat product discount', async () => {
    const client = await mongoose.model('ClientAccount').create({
      clientCode: 'CUS-PT-4', username: 'pt_dealer_flat', password: 'x',
      name: 'Flat Dealer', paymentMethod: 'Cash', isActive: true, segments: ['Dealer'],
    });
    const prod = await mongoose.model('Product').create({
      name: 'PT Flat Product', category: 'PT-Cat', basePrice: 100, discountPercent: 25,
    });
    const res = await auth('post', '/api/orders', staffTok).send({
      items: [{ productId: String(prod._id), name: 'PT Flat Product', price: 100, quantity: 1 }],
      table: 'Takeout', paymentMethod: 'Cash', clientAccountId: String(client._id),
    });
    expect(res.status).toBe(200);
    expect(res.body.order.total).toBeCloseTo(75, 2); // the 25% promo beats Dealer's 15%
  });

  it('an untagged walk-in is unaffected by tiers', async () => {
    const prod = await mongoose.model('Product').create({
      name: 'PT Walkin Product', category: 'PT-Cat', basePrice: 100,
    });
    const res = await auth('post', '/api/orders', staffTok).send({
      items: [{ productId: String(prod._id), name: 'PT Walkin Product', price: 100, quantity: 1 }],
      table: 'Takeout', paymentMethod: 'Cash',
    });
    expect(res.status).toBe(200);
    expect(res.body.order.total).toBeCloseTo(100, 2);
  });

  it('an inactive tier grants nothing', async () => {
    const made = await auth('post', '/api/price-tiers', superTok).send({ name: 'Retired', percent: 40, isActive: false });
    expect(made.status).toBe(200);
    const client = await mongoose.model('ClientAccount').create({
      clientCode: 'CUS-PT-5', username: 'pt_retired', password: 'x',
      name: 'Retired Tier Buyer', paymentMethod: 'Cash', isActive: true, segments: ['Retired'],
    });
    const prod = await mongoose.model('Product').create({
      name: 'PT Retired Product', category: 'PT-Cat', basePrice: 100,
    });
    const res = await auth('post', '/api/orders', staffTok).send({
      items: [{ productId: String(prod._id), name: 'PT Retired Product', price: 100, quantity: 1 }],
      table: 'Takeout', paymentMethod: 'Cash', clientAccountId: String(client._id),
    });
    expect(res.status).toBe(200);
    expect(res.body.order.total).toBeCloseTo(100, 2);
  });
});

describe('per_product pricing mode: explicit price list instead of a flat percent', () => {
  it('charges the tier price for a listed product, ignoring the (unused) percent field', async () => {
    const made = await auth('post', '/api/price-tiers', superTok).send({ name: 'Wholesaler', percent: 50, pricingMode: 'per_product' });
    const tierId = made.body.tier._id;
    expect(made.body.tier.pricingMode).toBe('per_product');

    const prod = await mongoose.model('Product').create({ name: 'PT PP Product', category: 'PT-Cat', basePrice: 200 });
    const setPrices = await auth('put', `/api/price-tiers/${tierId}/products`, superTok).send({ prices: [{ productId: String(prod._id), price: 150 }] });
    expect(setPrices.status).toBe(200);

    const client = await mongoose.model('ClientAccount').create({
      clientCode: 'CUS-PT-8', username: 'pt_wholesale', password: 'x',
      name: 'Wholesale Buyer', paymentMethod: 'Cash', isActive: true, segments: ['Wholesaler'],
    });
    const res = await auth('post', '/api/orders', staffTok).send({
      items: [{ productId: String(prod._id), name: 'PT PP Product', price: 200, quantity: 1 }],
      table: 'Takeout', paymentMethod: 'Cash', clientAccountId: String(client._id),
    });
    expect(res.status).toBe(200);
    // 150, not the 100 (50%) the ignored `percent` field would have implied.
    expect(res.body.order.total).toBeCloseTo(150, 2);
  });

  it('grants nothing for a product with no row in the price list', async () => {
    const made = await auth('post', '/api/price-tiers', superTok).send({ name: 'Listed Only', pricingMode: 'per_product' });
    const tierId = made.body.tier._id;
    const listed = await mongoose.model('Product').create({ name: 'PT Listed Product', category: 'PT-Cat', basePrice: 100 });
    const unlisted = await mongoose.model('Product').create({ name: 'PT Unlisted Product', category: 'PT-Cat', basePrice: 100 });
    await auth('put', `/api/price-tiers/${tierId}/products`, superTok).send({ prices: [{ productId: String(listed._id), price: 60 }] });

    const client = await mongoose.model('ClientAccount').create({
      clientCode: 'CUS-PT-9', username: 'pt_listed', password: 'x',
      name: 'Listed Only Buyer', paymentMethod: 'Cash', isActive: true, segments: ['Listed Only'],
    });
    const res = await auth('post', '/api/orders', staffTok).send({
      items: [
        { productId: String(listed._id), name: 'PT Listed Product', price: 100, quantity: 1 },
        { productId: String(unlisted._id), name: 'PT Unlisted Product', price: 100, quantity: 1 },
      ],
      table: 'Takeout', paymentMethod: 'Cash', clientAccountId: String(client._id),
    });
    expect(res.status).toBe(200);
    // 60 (listed) + 100 (unlisted, full price - not on this tier's list) = 160
    expect(res.body.order.total).toBeCloseTo(160, 2);
  });

  it('refuses an unknown or foreign productId in the price list', async () => {
    const made = await auth('post', '/api/price-tiers', superTok).send({ name: 'Guarded List', pricingMode: 'per_product' });
    const res = await auth('put', `/api/price-tiers/${made.body.tier._id}/products`, superTok)
      .send({ prices: [{ productId: '000000000000000000000000', price: 10 }] });
    expect(res.status).toBe(200);
    expect(res.body.tier.productPrices.length).toBe(0); // silently dropped, not stored
  });

  it('the pricing table reflects both modes correctly', async () => {
    const prod = await mongoose.model('Product').create({ name: 'PT Table Product', category: 'PT-Cat', basePrice: 100 });
    const flat = await auth('post', '/api/price-tiers', superTok).send({ name: 'Table Flat', percent: 20 });
    const pp = await auth('post', '/api/price-tiers', superTok).send({ name: 'Table PP', pricingMode: 'per_product' });
    await auth('put', `/api/price-tiers/${pp.body.tier._id}/products`, superTok).send({ prices: [{ productId: String(prod._id), price: 77 }] });

    const table = await auth('get', '/api/price-tiers/pricing-table', staffTok);
    expect(table.status).toBe(200);
    const flatRow = table.body.tiers.find(t => t._id === flat.body.tier._id);
    const ppRow = table.body.tiers.find(t => t._id === pp.body.tier._id);
    expect(flatRow.prices[String(prod._id)]).toBe(80);
    expect(ppRow.prices[String(prod._id)]).toBe(77);
  });
});

describe('price tier rename and delete safety', () => {
  it('renaming re-tags the clients carrying the old name', async () => {
    const made = await auth('post', '/api/price-tiers', superTok).send({ name: 'Provincial', percent: 12 });
    const tierId = made.body.tier._id;
    const client = await mongoose.model('ClientAccount').create({
      clientCode: 'CUS-PT-6', username: 'pt_prov', password: 'x',
      name: 'Provincial Buyer', paymentMethod: 'Cash', isActive: true, segments: ['Provincial'],
    });

    const res = await auth('put', `/api/price-tiers/${tierId}`, superTok).send({ name: 'Regional' });
    expect(res.status).toBe(200);
    expect(res.body.retagged).toBe(1);

    const after = await mongoose.model('ClientAccount').findById(client._id).lean();
    expect(after.segments).toContain('Regional');
    expect(after.segments).not.toContain('Provincial');

    // And the rate still lands, proving the cascade kept the two sides in sync.
    const prod = await mongoose.model('Product').create({
      name: 'PT Rename Product', category: 'PT-Cat', basePrice: 100,
    });
    const order = await auth('post', '/api/orders', staffTok).send({
      items: [{ productId: String(prod._id), name: 'PT Rename Product', price: 100, quantity: 1 }],
      table: 'Takeout', paymentMethod: 'Cash', clientAccountId: String(client._id),
    });
    expect(order.body.order.total).toBeCloseTo(88, 2);
  });

  it('refuses to delete a tier that clients are still assigned to', async () => {
    const made = await auth('post', '/api/price-tiers', superTok).send({ name: 'InUse', percent: 5 });
    await mongoose.model('ClientAccount').create({
      clientCode: 'CUS-PT-7', username: 'pt_inuse', password: 'x',
      name: 'In Use Buyer', paymentMethod: 'Cash', isActive: true, segments: ['InUse'],
    });
    const res = await auth('delete', `/api/price-tiers/${made.body.tier._id}`, superTok);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/still assigned/i);
  });

  it('deletes a tier nobody is assigned to', async () => {
    const made = await auth('post', '/api/price-tiers', superTok).send({ name: 'Unused', percent: 5 });
    const res = await auth('delete', `/api/price-tiers/${made.body.tier._id}`, superTok);
    expect(res.status).toBe(200);
  });
});
