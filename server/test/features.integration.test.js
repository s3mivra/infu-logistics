// Recent-feature coverage (log mode): low-stock analytics must exclude inventory tied only
// to removed products, and billing numbers must still generate in log after the "make same"
// change.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, staffTok, superTok, prod;

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'ft_super', role: 'superadmin' });
  await makeUser({ name: 'ft_staff', role: 'staff' });
  superTok = await loginStaff(app, 'ft_super');
  staffTok = await loginStaff(app, 'ft_staff');

  const Inventory = mongoose.model('Inventory');
  const Product = mongoose.model('Product');
  await mongoose.model('Category').create({ name: 'FT', department: 'Kitchen' });

  // Two out-of-stock items (daysOfSupply 0 → both candidates for the low-stock list):
  const removedStock = await Inventory.create({ itemName: 'Removed Stock', stockQty: 0, unit: 'pcs', unitCost: 1 });
  const activeStock  = await Inventory.create({ itemName: 'Active Stock',  stockQty: 0, unit: 'pcs', unitCost: 1 });

  // One ACTIVE product backed by activeStock; one REMOVED product backed by removedStock.
  await Product.create({ name: 'Active Prod', category: 'FT', basePrice: 10, isAvailable: true,
    baseRecipe: [{ invId: String(activeStock._id), name: 'Active Stock', qty: 1, unit: 'pcs' }] });
  await Product.create({ name: 'Removed Prod', category: 'FT', basePrice: 10, isAvailable: false,
    baseRecipe: [{ invId: String(removedStock._id), name: 'Removed Stock', qty: 1, unit: 'pcs' }] });

  prod = await Product.create({ name: 'FT Good', category: 'FT', basePrice: 100,
    baseRecipe: [{ invId: String(activeStock._id), name: 'Active Stock', qty: 1, unit: 'pcs' }] });
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('low-stock analytics excludes stock tied only to removed products', () => {
  it('lists the active-product item but not the removed-product item', async () => {
    const res = await request(app).get('/api/analytics/dashboard').set('Authorization', `Bearer ${staffTok}`);
    expect(res.status).toBe(200);
    const names = res.body.lowestStock.map(i => i.itemName);
    expect(names).toContain('Active Stock');
    expect(names).not.toContain('Removed Stock');
  });
});

describe('log mode: billing numbers still generate (make-same did not break log)', () => {
  it('order creation stamps a billing number', async () => {
    const res = await request(app).post('/api/orders').set('Authorization', `Bearer ${staffTok}`)
      .send({ items: [{ productId: String(prod._id), name: 'FT Good', price: 100, quantity: 1 }], table: 'Pickup', paymentMethod: 'Cash' });
    expect(res.status).toBe(200);
    expect(res.body.order.billingNumber).toMatch(/^\d{4}-\d{2}-\d{4}$/);
  });
});
