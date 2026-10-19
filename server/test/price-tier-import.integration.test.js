// A price list in the setup workbook's "Price Tiers" sheet - the same layout
// Pricing Control exports: Code | Product | List Price | one column per tier.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';
import { normaliseInventoryRow, inventoryImportPayload } from '../../client/src/shared/importSheets.js';

let ctx, app, tok;
const as = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const M = (n) => mongoose.model(n);
const importTiers = (rows) => as('post', '/api/setup/price-tiers/import').send({ rows });
const tierPrice = async (tierName, productName) => {
  const t = await M('PriceTier').findOne({ name: tierName }).lean();
  const p = await M('Product').findOne({ name: productName }).lean();
  return t?.productPrices?.find(x => String(x.productId) === String(p?._id))?.price;
};

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'tierBoss', role: 'superadmin' });
  tok = await loginStaff(app, 'tierBoss');
  await M('Product').create({ productCode: 'P10001', name: 'COMMERCIAL BLEND', category: 'Beans', basePrice: 950, businessType: 'log' });
  await M('Product').create({ productCode: 'P10003', name: 'SPECIALTY YUNAN (CHINA)', category: 'Beans', basePrice: 1800, businessType: 'log' });
  await M('Product').create({ name: 'NO CODE BEANS', category: 'Beans', basePrice: 500, businessType: 'log' });
}, 120000);
afterAll(async () => { await ctx.stop(); });

describe('importing a price list', () => {
  it('creates each tier column as a per-product price list, matched by code then name', async () => {
    const r = await importTiers([
      { Code: 'P10001', Product: 'COMMERCIAL BLEND', 'List Price': 950, 'Satellite Price': 807.5, 'Preciso Price': 880, Affiliate: 600 },
      // the sheet spells it differently - the code still matches
      { Code: 'P10003', Product: 'SPECIALTY YUNAN', 'List Price': 1800, 'Satellite Price': '', 'Preciso Price': '1,600', Affiliate: 771 },
      { Code: '', Product: 'NO CODE BEANS', 'List Price': 500, 'Satellite Price': 450, 'Preciso Price': '', Affiliate: '' },
    ]);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await tierPrice('Satellite Price', 'COMMERCIAL BLEND')).toBe(807.5);
    expect(await tierPrice('Preciso Price', 'SPECIALTY YUNAN (CHINA)')).toBe(1600);
    expect(await tierPrice('Satellite Price', 'NO CODE BEANS')).toBe(450);
    expect(await tierPrice('Satellite Price', 'SPECIALTY YUNAN (CHINA)')).toBeUndefined();   // blank = no price
    const t = await M('PriceTier').findOne({ name: 'Affiliate' }).lean();
    expect(t.pricingMode).toBe('per_product');
    // List Price is for reading only
    expect((await M('Product').findOne({ productCode: 'P10001' }).lean()).basePrice).toBe(950);
  });

  it('a second sheet updates a tier without wiping the prices it does not mention', async () => {
    const r = await importTiers([{ Code: 'P10001', Product: 'COMMERCIAL BLEND', 'List Price': 950, 'satellite price': 800 }]);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await M('PriceTier').countDocuments({ name: /^satellite price$/i })).toBe(1);   // same tier, any case
    expect(await tierPrice('Satellite Price', 'COMMERCIAL BLEND')).toBe(800);
    expect(await tierPrice('Satellite Price', 'NO CODE BEANS')).toBe(450);
  });

  it('refuses a cell that is not a price, and imports nothing', async () => {
    const before = await tierPrice('Preciso Price', 'COMMERCIAL BLEND');
    const r = await importTiers([{ Code: 'P10001', Product: 'COMMERCIAL BLEND', 'Preciso Price': 'call us' }]);
    expect(r.status).toBe(400);
    expect(r.body.problems.join(' ')).toMatch(/not a price/);
    expect(await tierPrice('Preciso Price', 'COMMERCIAL BLEND')).toBe(before);
  });
});

describe('prices for products not created yet', () => {
  it('wait, then apply when the inventory import creates the products', async () => {
    const r = await importTiers([{ Code: 'P50012', Product: 'ALASKA CONDENSED MILK', 'List Price': 79, 'Dealer & Partner Price': 72 }]);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.waiting).toBe(1);
    expect(await M('Product').countDocuments({ productCode: 'P50012' })).toBe(0);

    const inv = await as('post', '/api/inventory/import').send(inventoryImportPayload([normaliseInventoryRow({
      Code: 'P50012', Product: 'ALASKA CONDENSED MILK', Pack: '377', Unit: 'g', Qty: '648', 'Cost / pack': '66', 'SRP / pack': '79',
    })]));
    expect(inv.status, JSON.stringify(inv.body)).toBe(200);
    expect(inv.body.summary.tierPricesApplied).toBe(1);
    expect(await tierPrice('Dealer & Partner Price', 'ALASKA CONDENSED MILK')).toBe(72);
    const pending = await M('Settings').findOne({ key: 'pendingTierPrices' }).lean();
    expect(pending.value).toHaveLength(0);
  });
});
