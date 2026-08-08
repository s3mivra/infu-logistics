// /api/products must return a `unitLabel` derived from each product's linked
// INVENTORY item (packSize + display unit), normalised the same way the inventory
// screen shows it: a sub-1 kg pack reads in grams. This is what the order slip's
// Unit column renders, so the portal (anonymous) path must carry it too.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app;

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'pu_super', role: 'superadmin' });

  const Inventory = mongoose.model('Inventory');
  const Product = mongoose.model('Product');

  // Sub-1 kg pack → should read "377g".
  await Inventory.create({ itemCode: 'RML-0100', itemName: 'Specialty Brazil', unit: 'g', displayUnit: 'kg', packSize: 0.377, stockQty: 100000, unitCost: 0.2, businessType: 'log' });
  await Product.create({ name: 'Specialty Brazil', productCode: 'RML-0100', basePrice: 1800, businessType: 'log', baseRecipe: [] });

  // Whole kg → stays "1kg".
  await Inventory.create({ itemCode: 'RML-0101', itemName: 'Hibiscus Tea', unit: 'g', displayUnit: 'kg', packSize: 1, stockQty: 100000, unitCost: 0.1, businessType: 'log' });
  await Product.create({ name: 'Hibiscus Tea', productCode: 'RML-0101', basePrice: 380, businessType: 'log', baseRecipe: [] });
});

afterAll(async () => { await ctx?.stop?.(); });

const products = async (tok) => {
  const r = tok
    ? await request(app).get('/api/products').set('Authorization', `Bearer ${tok}`)
    : await request(app).get('/api/products');
  const byCode = {};
  for (const p of r.body.products) byCode[p.productCode] = p;
  return byCode;
};

describe('GET /api/products — unitLabel from inventory', () => {
  it('normalises a sub-1 kg pack to grams (anonymous / portal caller)', async () => {
    const p = await products();
    expect(p['RML-0100'].unitLabel).toBe('377g');
    expect(p['RML-0101'].unitLabel).toBe('1kg');
  });

  it('carries the same label for an authenticated staff caller', async () => {
    const tok = await loginStaff(app, 'pu_super');
    const p = await products(tok);
    expect(p['RML-0100'].unitLabel).toBe('377g');
    expect(p['RML-0101'].unitLabel).toBe('1kg');
  });
});
