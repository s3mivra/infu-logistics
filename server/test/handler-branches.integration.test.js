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

  // Regression: gain/loss must be valued at the EXISTING book cost of the units
  // being adjusted, not a new cost typed into the same import row. Previously a
  // row that updated both qty and unitCost together (a common real-world case —
  // "here's the new count AND the new price") valued the variance at the new
  // cost, which either overstates or understates the loss/gain depending on
  // whether the price went up or down.
  it('gain/loss on import is valued at the OLD unit cost, not a new cost from the same row', async () => {
    const Inventory = mongoose.model('Inventory');
    await Inventory.create({ itemCode: 'HB-GL-1', itemName: 'GL Item', stockQty: 100, unit: 'pcs', unitCost: 10, displayUnit: 'pcs', unitMultiplier: 1 });

    // Shortfall (100 → 50) with a simultaneous cost bump (10 → 20): the 50-unit
    // loss must be valued at the OLD cost (10), i.e. 500 — not the new cost (1000).
    const lossRes = await post('/api/inventory/import', superTok, {
      items: [{ itemCode: 'HB-GL-1', itemName: 'GL Item', qty: 50, unit: 'pcs', unitCost: 20 }],
    });
    expect(lossRes.body.summary.lossValue).toBe(500);
    expect(lossRes.body.summary.decreased).toBe(1);
    const afterLoss = await Inventory.findOne({ itemCode: 'HB-GL-1' }).lean();
    expect(afterLoss.unitCost).toBe(20); // new cost still applies going forward
    expect(afterLoss.stockQty).toBe(50);

    // Gain (50 → 70) with another cost bump (20 → 25): valued at the book cost
    // in effect at the START of this row (20), i.e. 20 units * 20 = 400.
    const gainRes = await post('/api/inventory/import', superTok, {
      items: [{ itemCode: 'HB-GL-1', itemName: 'GL Item', qty: 70, unit: 'pcs', unitCost: 25 }],
    });
    expect(gainRes.body.summary.gainValue).toBe(400);
    expect(gainRes.body.summary.increased).toBe(1);
  });
});
