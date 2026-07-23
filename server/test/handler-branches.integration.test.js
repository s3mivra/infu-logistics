// Deep handler branches the happy-path suites don't reach: size-specific recipe
// deduction, add-on recipe deduction, and the import "update existing item" path.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, superTok, staffTok;
const ids = {};

const post = (p, tok, body) => request(app).post(p).set('Authorization', `Bearer ${tok}`).send(body);
const put = (p, tok, body) => request(app).put(p).set('Authorization', `Bearer ${tok}`).send(body);
const stock = async (id) => (await mongoose.model('Inventory').findById(id).lean()).stockQty;

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'hb_super', role: 'superadmin' });
  await makeUser({ name: 'hb_staff', role: 'staff' });
  superTok = await loginStaff(app, 'hb_super');
  staffTok = await loginStaff(app, 'hb_staff');

  const Inventory = mongoose.model('Inventory');
  const Product = mongoose.model('Product');
  await mongoose.model('Category').create({ name: 'HB', department: 'Kitchen' });
  ids.base = String((await Inventory.create({ itemName: 'HB Base', stockQty: 100000, unit: 'g', unitCost: 0.5 }))._id);
  ids.size = String((await Inventory.create({ itemName: 'HB Size', stockQty: 100000, unit: 'g', unitCost: 0.5 }))._id);
  ids.addon = String((await Inventory.create({ itemName: 'HB Addon', stockQty: 100000, unit: 'g', unitCost: 0.5 }))._id);
  ids.product = String((await Product.create({
    name: 'HB Coffee', category: 'HB', basePrice: 120,
    baseRecipe: [{ invId: ids.base, name: 'HB Base', qty: 5, cost: 2.5, unit: 'g' }],
    sizes: [{ sizeCode: 'L', name: 'Large', price: 150, recipe: [{ invId: ids.size, name: 'HB Size', qty: 8, cost: 4, unit: 'g' }] }],
    addOns: [{ name: 'Extra Shot', price: 20, recipe: [{ invId: ids.addon, name: 'HB Addon', qty: 3, cost: 1.5, unit: 'g' }] }],
  }))._id);
});

afterAll(async () => { await ctx.stop(); });

describe('recipe variant deduction on completion', () => {
  it('a SIZE order deducts the size recipe (not the base recipe)', async () => {
    const beforeSize = await stock(ids.size);
    const beforeBase = await stock(ids.base);
    const o = await post('/api/orders', staffTok, { items: [{ productId: ids.product, name: 'HB Coffee (Large)', price: 150, quantity: 1 }], table: 'Takeout', paymentMethod: 'Cash' });
    expect(o.status).toBe(200);
    expect((await put(`/api/orders/${o.body.order._id}`, staffTok, { status: 'Completed' })).status).toBe(200);
    expect(beforeSize - (await stock(ids.size))).toBe(8); // size recipe consumed
    expect(beforeBase - (await stock(ids.base))).toBe(0); // base recipe NOT consumed for a sized line
  });

  it('an ADD-ON order deducts both the base recipe and the add-on recipe', async () => {
    const beforeBase = await stock(ids.base);
    const beforeAddon = await stock(ids.addon);
    const o = await post('/api/orders', staffTok, { items: [{ productId: ids.product, name: 'HB Coffee', price: 120, quantity: 1, selectedAddOns: [{ name: 'Extra Shot', price: 20 }] }], table: 'Takeout', paymentMethod: 'Cash' });
    expect(o.status).toBe(200);
    expect((await put(`/api/orders/${o.body.order._id}`, staffTok, { status: 'Completed' })).status).toBe(200);
    expect(beforeBase - (await stock(ids.base))).toBe(5);   // base recipe
    expect(beforeAddon - (await stock(ids.addon))).toBe(3); // add-on recipe
  });
});

describe('inventory import — update existing item path', () => {
  it('re-importing an existing item updates it (diff), not creates a duplicate', async () => {
    await mongoose.model('Inventory').create({ itemName: 'HB Imported', stockQty: 1000, unit: 'g', unitCost: 0.2, displayUnit: 'kg', unitMultiplier: 1000 });
    const r = await post('/api/inventory/import', superTok, { items: [{ itemName: 'HB Imported', qty: 5, unit: 'kg', unitCost: 0.25 }] });
    expect(r.status).toBe(200);
    expect(r.body.summary.updated).toBeGreaterThanOrEqual(1);
    const count = await mongoose.model('Inventory').countDocuments({ itemName: 'HB Imported' });
    expect(count).toBe(1); // updated, not duplicated
  });

  // Regression: basePrice was set via BOTH $set and $setOnInsert in the same
  // Product upsert whenever the row carried a category + srp, which Mongo
  // rejects outright ("Updating the path 'basePrice' would create a conflict").
  it('re-importing an item with a category + srp does not 500 (basePrice $set/$setOnInsert conflict)', async () => {
    await mongoose.model('Inventory').create({ itemName: 'HB SRP Item', itemCode: 'HB-SRP-1', stockQty: 1000, unit: 'g', unitCost: 0.2, displayUnit: 'kg', unitMultiplier: 1000 });
    const r = await post('/api/inventory/import', superTok, {
      items: [{ itemCode: 'HB-SRP-1', itemName: 'HB SRP Item', qty: 5, unit: 'kg', unitCost: 0.25, category: 'HB Category', srp: 199.99 }],
    });
    expect(r.status).toBe(200);
    expect(r.body.summary.updated).toBeGreaterThanOrEqual(1);
    const product = await mongoose.model('Product').findOne({ productCode: 'HB-SRP-1' });
    expect(product).toBeTruthy();
    expect(product.basePrice).toBe(199.99);
  });

  it('creating a brand-new item with a category + srp sets basePrice on the new Product', async () => {
    const r = await post('/api/inventory/import', superTok, {
      items: [{ itemCode: 'HB-SRP-2', itemName: 'HB New SRP Item', qty: 3, unit: 'kg', unitCost: 0.3, category: 'HB Category', srp: 250 }],
    });
    expect(r.status).toBe(200);
    expect(r.body.summary.created).toBeGreaterThanOrEqual(1);
    const product = await mongoose.model('Product').findOne({ productCode: 'HB-SRP-2' });
    expect(product).toBeTruthy();
    expect(product.basePrice).toBe(250);
  });
});
