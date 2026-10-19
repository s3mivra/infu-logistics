// Recipe quantities must survive a save/reopen round trip.
//
// `qty` is stored in BASE units (150 ml), while the editor shows it as a
// fraction of a pack (0.15 of a 1L carton). The conversion factor is packBase,
// and it was never persisted - so every time a product was reopened the editor
// could not reconstruct the fraction, and "fixed" it by resetting qty to one
// full pack. Enter 0.15, save, reopen, and the recipe silently read 1 again,
// with the cost recomputed to a full carton.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let app, stop, tok;

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'fb', jwtSecret: 'packbase-secret-0123456789' }));
  await makeUser({ name: 'PackBoss', role: 'superadmin', password: 'pw' });
  tok = await loginStaff(app, 'PackBoss', 'pw');
}, 120000);

afterAll(async () => { await stop(); });

const auth = () => ({ Authorization: `Bearer ${tok}` });

describe('recipe packBase round trip', () => {
  it('keeps both the quantity and its pack conversion on create', async () => {
    const inv = (await request(app).post('/api/inventory').set(auth())
      .send({ itemName: 'ALASKA BARISTA 1L', unit: 'ml', stockQty: 10000, unitCost: 0.2 })).body.item;

    // 0.15 of a 1L carton = 150 ml, which is what the client sends.
    const created = await request(app).post('/api/products').set(auth()).send({
      name: 'Packbase Latte', basePrice: 150, category: 'Drinks',
      baseRecipe: [{ invId: String(inv._id), name: inv.itemName, qty: 150, cost: 0.2, unit: '1L', packBase: 1000 }],
    });
    expect(created.status).toBeLessThan(400);
    const id = created.body.product?._id || created.body._id;

    const saved = await mongoose.model('Product').findById(id).lean();
    expect(saved.baseRecipe[0].qty).toBe(150);
    // Without this the editor cannot tell 150ml from 150 cartons.
    expect(saved.baseRecipe[0].packBase).toBe(1000);
  });

  it('keeps them through an update too', async () => {
    const inv = (await request(app).post('/api/inventory').set(auth())
      .send({ itemName: 'ESPRESSO BEANS 1KG', unit: 'g', stockQty: 50000, unitCost: 0.8 })).body.item;
    const created = await request(app).post('/api/products').set(auth()).send({
      name: 'Packbase Update', basePrice: 200, category: 'Drinks',
      baseRecipe: [{ invId: String(inv._id), name: inv.itemName, qty: 1000, cost: 0.8, unit: '1kg', packBase: 1000 }],
    });
    const id = created.body.product?._id || created.body._id;

    // The user edits 1 pack down to 0.018 of a pack (18 g, a single shot).
    const updated = await request(app).put(`/api/products/${id}`).set({ ...auth(), 'X-Change-Reason': 'recipe fix' }).send({
      baseRecipe: [{ invId: String(inv._id), name: inv.itemName, qty: 18, cost: 0.8, unit: '1kg', packBase: 1000 }],
    });
    expect(updated.status).toBeLessThan(400);

    const saved = await mongoose.model('Product').findById(id).lean();
    // The number the user actually typed, not a reset to one full pack.
    expect(saved.baseRecipe[0].qty).toBe(18);
    expect(saved.baseRecipe[0].packBase).toBe(1000);
  });

  it('keeps them on size recipes as well', async () => {
    const inv = (await request(app).post('/api/inventory').set(auth())
      .send({ itemName: 'SYRUP 750ML', unit: 'ml', stockQty: 7500, unitCost: 0.4 })).body.item;
    const created = await request(app).post('/api/products').set(auth()).send({
      name: 'Packbase Sizes', basePrice: 120, category: 'Drinks',
      sizes: [{ name: '12oz Iced', price: 120, recipe: [{ invId: String(inv._id), name: inv.itemName, qty: 30, cost: 0.4, unit: '750ml', packBase: 750 }] }],
    });
    expect(created.status).toBeLessThan(400);
    const id = created.body.product?._id || created.body._id;
    const saved = await mongoose.model('Product').findById(id).lean();
    expect(saved.sizes[0].recipe[0].qty).toBe(30);
    expect(saved.sizes[0].recipe[0].packBase).toBe(750);
  });
});
