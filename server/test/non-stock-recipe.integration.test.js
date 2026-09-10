// Non-stock recipe ingredients: measured, recorded, never deducted, never costed.
//
// Filtered water is the case that forced this. It belongs in the recipe so a
// drink can be made the same way twice, but there is nothing to deduct - you
// never bought units of it, so no quantity can run out. Its cost stays out of
// COGS: an invented cost has no credit side, and the filter and water bill are
// already expenses, so charging drinks for water would count the money twice.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let app, stop, tok;

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'fb', jwtSecret: 'nonstock-secret-0123456789' }));
  await makeUser({ name: 'WaterBoss', role: 'superadmin', password: 'pw' });
  tok = await loginStaff(app, 'WaterBoss', 'pw');
}, 120000);

afterAll(async () => { await stop(); });

const auth = () => ({ Authorization: `Bearer ${tok}` });

describe('non-stock recipe ingredients', () => {
  it('a sale deducts the stocked ingredient but not the non-stock one', async () => {
    const Inventory = mongoose.model('Inventory');
    const Product = mongoose.model('Product');

    const beans = await Inventory.create({ itemName: 'COLD BREW BEANS', unit: 'g', stockQty: 1000, unitCost: 2 });
    const product = await Product.create({
      name: 'Cold Brew', basePrice: 180, businessType: 'fb',
      baseRecipe: [
        { invId: String(beans._id), name: 'COLD BREW BEANS', qty: 20, cost: 2, unit: 'g' },
        // No invId, and flagged: this is the filtered water.
        { name: 'FILTERED WATER', qty: 200, cost: 0, unit: 'ml', nonStock: true },
      ],
    });

    const res = await request(app).post('/api/orders').set(auth())
      .send({ items: [{ name: product.name, price: 180, quantity: 2 }], table: 'Takeout', paymentMethod: 'Cash' });
    expect(res.status).toBeLessThan(400);

    const done = await request(app).put(`/api/orders/${res.body.order._id}`).set(auth()).send({ status: 'Completed' });
    expect(done.status).toBe(200);

    // The real ingredient moved: 20g x 2 drinks.
    const after = await Inventory.findById(beans._id).lean();
    expect(after.stockQty).toBe(1000 - 40);
  });

  it('stays non-deducting even when a stock item of the SAME NAME exists', async () => {
    const Inventory = mongoose.model('Inventory');
    const Product = mongoose.model('Product');

    // Ingredients normally resolve by name when invId is absent, so this is the
    // trap: someone adds a stock item called FILTERED WATER months later and
    // every cold brew silently starts draining it. The nonStock flag must win.
    const water = await Inventory.create({ itemName: 'FILTERED WATER', unit: 'ml', stockQty: 5000, unitCost: 1 });
    const beans = await Inventory.create({ itemName: 'HOUSE BEANS', unit: 'g', stockQty: 500, unitCost: 3 });
    const product = await Product.create({
      name: 'Americano', basePrice: 120, businessType: 'fb',
      baseRecipe: [
        { invId: String(beans._id), name: 'HOUSE BEANS', qty: 10, cost: 3, unit: 'g' },
        { name: 'FILTERED WATER', qty: 150, cost: 0, unit: 'ml', nonStock: true },
      ],
    });

    const res = await request(app).post('/api/orders').set(auth())
      .send({ items: [{ name: product.name, price: 120, quantity: 3 }], table: 'Takeout', paymentMethod: 'Cash' });
    expect(res.status).toBeLessThan(400);
    const done = await request(app).put(`/api/orders/${res.body.order._id}`).set(auth()).send({ status: 'Completed' });
    expect(done.status).toBe(200);

    expect((await Inventory.findById(beans._id).lean()).stockQty).toBe(500 - 30);
    // Untouched - the whole point.
    expect((await Inventory.findById(water._id).lean()).stockQty).toBe(5000);
  });

  it('a non-stock ingredient can never block a sale for insufficient stock', async () => {
    const Product = mongoose.model('Product');
    // Nothing stocked at all behind it, and a large quantity: if it were being
    // treated as stock this would fail the availability check.
    const product = await Product.create({
      name: 'Iced Water', basePrice: 20, businessType: 'fb',
      baseRecipe: [{ name: 'FILTERED WATER', qty: 999999, cost: 0, unit: 'ml', nonStock: true }],
    });
    const res = await request(app).post('/api/orders').set(auth())
      .send({ items: [{ name: product.name, price: 20, quantity: 1 }], table: 'Takeout', paymentMethod: 'Cash' });
    expect(res.status).toBeLessThan(400);
    const done = await request(app).put(`/api/orders/${res.body.order._id}`).set(auth()).send({ status: 'Completed' });
    expect(done.status).toBe(200);
  });

  it('survives a round trip through the product API', async () => {
    const create = await request(app).post('/api/products').set(auth()).send({
      name: 'Round Trip Brew', basePrice: 150, category: 'Drinks',
      baseRecipe: [{ name: 'FILTERED WATER', qty: 200, cost: 0, unit: 'ml', nonStock: true }],
    });
    expect(create.status).toBeLessThan(400);
    const id = create.body.product?._id || create.body._id;
    const Product = mongoose.model('Product');
    const saved = await Product.findById(id).lean();
    // A flag the schema drops on save is a flag that does nothing in production.
    expect(saved.baseRecipe[0].nonStock).toBe(true);
    expect(saved.baseRecipe[0].name).toBe('FILTERED WATER');
  });
});
