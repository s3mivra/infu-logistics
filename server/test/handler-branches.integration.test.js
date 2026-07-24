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

// Regression: a log/1:1 product (no recipe — the product IS the stocked good)
// must be UNAVAILABLE when its linked inventory is missing entirely or has
// zero/insufficient stock, never default to "available" for a missing link.
describe('stockAvailable — log 1:1 product with no linked inventory', () => {
  it('a product whose linked inventory item does not exist is unavailable, not available', async () => {
    const Category = mongoose.model('Category');
    const Product = mongoose.model('Product');
    await Category.create({ name: 'NoLinkCat', department: 'Kitchen' });
    // No matching Inventory doc exists for this productCode/name at all.
    await Product.create({ name: 'Orphan 1:1 Good', productCode: 'ORPHAN-1', category: 'NoLinkCat', basePrice: 50 });

    const res = await request(app).get('/api/products');
    const p = res.body.products.find(x => x.productCode === 'ORPHAN-1');
    expect(p).toBeTruthy();
    expect(p.stockAvailable).toBe(false);
  });

  it('a product whose linked inventory has zero stock is unavailable', async () => {
    const Category = mongoose.model('Category');
    const Product = mongoose.model('Product');
    const Inventory = mongoose.model('Inventory');
    await Category.create({ name: 'ZeroStockCat', department: 'Kitchen' });
    await Inventory.create({ itemCode: 'ZS-1', itemName: 'Zero Stock Good', stockQty: 0, unit: 'pcs', unitCost: 5, displayUnit: 'pcs', unitMultiplier: 1 });
    await Product.create({ name: 'Zero Stock Good', productCode: 'ZS-1', category: 'ZeroStockCat', basePrice: 50 });

    const res = await request(app).get('/api/products');
    const p = res.body.products.find(x => x.productCode === 'ZS-1');
    expect(p).toBeTruthy();
    expect(p.stockAvailable).toBe(false);
  });

  it('a product with sufficient linked stock is available', async () => {
    const Category = mongoose.model('Category');
    const Product = mongoose.model('Product');
    const Inventory = mongoose.model('Inventory');
    await Category.create({ name: 'StockedCat', department: 'Kitchen' });
    await Inventory.create({ itemCode: 'OK-1', itemName: 'In Stock Good', stockQty: 50, unit: 'pcs', unitCost: 5, displayUnit: 'pcs', unitMultiplier: 1 });
    await Product.create({ name: 'In Stock Good', productCode: 'OK-1', category: 'StockedCat', basePrice: 50 });

    const res = await request(app).get('/api/products');
    const p = res.body.products.find(x => x.productCode === 'OK-1');
    expect(p).toBeTruthy();
    expect(p.stockAvailable).toBe(true);
  });
});

// In log mode, products ARE the stocked goods, so importing inventory must also
// create/update the linked Product — even when the sheet carries no category.
describe('log inventory import creates the linked product', () => {
  it('a new item with NO category still creates both the inventory item and a Product', async () => {
    const res = await post('/api/inventory/import', superTok, {
      items: [{ itemCode: 'LOGSYNC-1', itemName: 'Log Sync Good', qty: 10, unit: 'pcs', unitCost: 5, srp: 40 }],
    });
    expect(res.status).toBe(200);
    expect(res.body.summary.created).toBeGreaterThanOrEqual(1);

    const invItem = await mongoose.model('Inventory').findOne({ itemCode: 'LOGSYNC-1' });
    expect(invItem).toBeTruthy();

    const product = await mongoose.model('Product').findOne({ productCode: 'LOGSYNC-1' });
    expect(product).toBeTruthy();           // product created despite no category on the row
    expect(product.name).toBe('Log Sync Good');
    expect(product.basePrice).toBe(40);     // srp carried through
    expect(product.category).toBe('General'); // fallback bucket
    expect(product.isAvailable).toBe(true); // stock > 0
  });

  it('re-importing the same item with a new qty updates its Product availability', async () => {
    // Deplete it to zero → the linked product must become unavailable.
    const res = await post('/api/inventory/import', superTok, {
      items: [{ itemCode: 'LOGSYNC-1', itemName: 'Log Sync Good', qty: 0, unit: 'pcs' }],
    });
    expect(res.status).toBe(200);
    const product = await mongoose.model('Product').findOne({ productCode: 'LOGSYNC-1' });
    expect(product.isAvailable).toBe(false);
  });
});

describe('inventory import persists per-qty (pack) size', () => {
  it('accepts an explicit packSize from the client and stores it on create', async () => {
    const res = await post('/api/inventory/import', superTok, {
      items: [{ itemCode: 'PACK-1', itemName: 'Milk', qty: 10, unit: 'L', unitCost: 200, packSize: 1 }],
    });
    expect(res.status).toBe(200);
    const item = await mongoose.model('Inventory').findOne({ itemCode: 'PACK-1' }).lean();
    expect(item.packSize).toBe(1);
  });

  it('updates packSize on a re-import of an existing item', async () => {
    const res = await post('/api/inventory/import', superTok, {
      items: [{ itemCode: 'PACK-1', itemName: 'Milk', qty: 20, unit: 'L', unitCost: 200, packSize: 2 }],
    });
    expect(res.status).toBe(200);
    const item = await mongoose.model('Inventory').findOne({ itemCode: 'PACK-1' }).lean();
    expect(item.packSize).toBe(2);
  });

  it('falls back to parsing a trailing size off the item name when packSize is omitted', async () => {
    const res = await post('/api/inventory/import', superTok, {
      items: [{ itemCode: 'PACK-2', itemName: 'Filter 250G', qty: 5, unit: 'kg', unitCost: 100 }],
    });
    expect(res.status).toBe(200);
    const item = await mongoose.model('Inventory').findOne({ itemCode: 'PACK-2' }).lean();
    expect(item.packSize).toBeCloseTo(0.25, 5); // 250g → 0.25 kg
  });

  it('leaves packSize null when there is nothing to infer', async () => {
    const res = await post('/api/inventory/import', superTok, {
      items: [{ itemCode: 'PACK-3', itemName: 'Loose Rice', qty: 5, unit: 'kg', unitCost: 60 }],
    });
    expect(res.status).toBe(200);
    const item = await mongoose.model('Inventory').findOne({ itemCode: 'PACK-3' }).lean();
    expect(item.packSize).toBeNull();
  });
});

describe('import never merges two different-itemCode SKUs by cleaned name', () => {
  it('creates two distinct items when both provide an itemCode, even if their (post-size-strip) names match', async () => {
    const Inventory = mongoose.model('Inventory');
    // Simulates "DK Blueberry 3kg" (code DKB-3) and "DK Blueberry 2.5kg" (code
    // DKB-25) — the client strips the size suffix from both, so both rows carry
    // the same cleaned itemName "DK Blueberry". An itemCode miss must NEVER fall
    // back to a name match, or the second row silently overwrites the first.
    const r1 = await post('/api/inventory/import', superTok, {
      items: [{ itemCode: 'DKB-3', itemName: 'DK Blueberry', qty: 25, unit: 'kg', unitCost: 100, packSize: 3 }],
    });
    expect(r1.status).toBe(200);
    expect(r1.body.summary.created).toBe(1);

    const r2 = await post('/api/inventory/import', superTok, {
      items: [{ itemCode: 'DKB-25', itemName: 'DK Blueberry', qty: 0, unit: 'kg', unitCost: 100, packSize: 2.5 }],
    });
    expect(r2.status).toBe(200);
    expect(r2.body.summary.created).toBe(1); // NOT "updated" — a genuinely new SKU

    const item3kg = await Inventory.findOne({ itemCode: 'DKB-3' }).lean();
    const item25kg = await Inventory.findOne({ itemCode: 'DKB-25' }).lean();
    expect(item3kg).toBeTruthy();
    expect(item25kg).toBeTruthy();
    expect(item3kg._id.toString()).not.toBe(item25kg._id.toString());
    expect(item3kg.stockQty).toBeGreaterThan(0); // 25kg, untouched by the second row
    expect(item25kg.stockQty).toBe(0);
  });

  it('still name-matches when a row has NO itemCode at all', async () => {
    const Inventory = mongoose.model('Inventory');
    const r1 = await post('/api/inventory/import', superTok, {
      items: [{ itemName: 'No Code Good', qty: 10, unit: 'kg', unitCost: 50 }],
    });
    expect(r1.body.summary.created).toBe(1);
    const r2 = await post('/api/inventory/import', superTok, {
      items: [{ itemName: 'No Code Good', qty: 15, unit: 'kg', unitCost: 55 }],
    });
    expect(r2.body.summary.updated).toBe(1); // matched by name, as before
    const items = await Inventory.find({ itemName: 'No Code Good' }).lean();
    expect(items.length).toBe(1);
    expect(items[0].stockQty).toBe(15000); // 15kg in grams — the update won
  });
});

describe('editing an inventory item can set/clear packSize', () => {
  it('PUT /api/inventory/:id accepts and persists packSize', async () => {
    const Inventory = mongoose.model('Inventory');
    const item = await Inventory.create({ itemCode: 'EDIT-PACK-1', itemName: 'Edit Pack Good', stockQty: 100, unit: 'pcs', unitCost: 5, displayUnit: 'pcs', unitMultiplier: 1 });
    const res = await put(`/api/inventory/${item._id}`, superTok, { itemName: 'Edit Pack Good', unit: 'pcs', unitCost: 5, packSize: 1.5 });
    expect(res.status).toBe(200);
    expect(res.body.item.packSize).toBe(1.5);

    const cleared = await put(`/api/inventory/${item._id}`, superTok, { itemName: 'Edit Pack Good', unit: 'pcs', unitCost: 5, packSize: '' });
    expect(cleared.status).toBe(200);
    expect(cleared.body.item.packSize).toBeNull();
  });
});

describe('inventory import is tenant-scoped (no cross-businessType clobber)', () => {
  it('a log import never matches or overwrites an fb-owned row of the same code', async () => {
    const Inventory = mongoose.model('Inventory');
    // An fb-owned row sharing the itemCode the log import will use.
    await Inventory.create({ itemCode: 'XT-1', itemName: 'Cross Tenant Milk', stockQty: 999, unit: 'pcs', unitCost: 5, displayUnit: 'pcs', unitMultiplier: 1, businessType: 'fb' });

    const res = await post('/api/inventory/import', superTok, {
      items: [{ itemCode: 'XT-1', itemName: 'Cross Tenant Milk', qty: 10, unit: 'pcs', unitCost: 5 }],
    });
    expect(res.status).toBe(200);
    // The fb row is untouched…
    const fb = await Inventory.findOne({ itemCode: 'XT-1', businessType: 'fb' }).lean();
    expect(fb.stockQty).toBe(999);
    // …and a NEW log row was created (created, not updated) with businessType 'log'.
    const log = await Inventory.findOne({ itemCode: 'XT-1', businessType: 'log' }).lean();
    expect(log).toBeTruthy();
    expect(log.stockQty).toBe(10);
    expect(res.body.summary.created).toBeGreaterThanOrEqual(1);
  });
});

describe('auto low-stock threshold from velocity', () => {
  const get = (p, tok) => request(app).get(p).set('Authorization', `Bearer ${tok}`);

  it('derives an autoThreshold for a fast-moving item with no manual threshold', async () => {
    const Inventory = mongoose.model('Inventory');
    const Product = mongoose.model('Product');
    const Order = mongoose.model('Order');
    // 1:1 log good, no lowStockThreshold set.
    await Inventory.create({ itemCode: 'VEL-1', itemName: 'Velocity Good', stockQty: 200, unit: 'pcs', unitCost: 5, displayUnit: 'pcs', unitMultiplier: 1 });
    const prod = await Product.create({ name: 'Velocity Good', productCode: 'VEL-1', category: 'VelCat', basePrice: 40 });
    // 60 sold over the last 30 days → ADU 2/day → autoThreshold = ceil(2*4) = 8.
    await Order.create({
      status: 'Completed', createdAt: new Date(Date.now() - 3 * 86400000), businessType: 'log',
      items: [{ productId: String(prod._id), name: 'Velocity Good', quantity: 60, price: 40 }],
      total: 2400, subtotal: 2400,
    });

    const res = await get('/api/inventory', superTok);
    expect(res.status).toBe(200);
    const item = res.body.items.find(i => i.itemCode === 'VEL-1');
    expect(item.thresholdIsAuto).toBe(true);
    expect(item.autoThreshold).toBe(8);
    expect(item.effectiveThreshold).toBe(8);
  });

  it('never overrides an explicit manual threshold', async () => {
    const Inventory = mongoose.model('Inventory');
    await Inventory.create({ itemCode: 'VEL-2', itemName: 'Manual Threshold Good', stockQty: 200, unit: 'pcs', unitCost: 5, lowStockThreshold: 25, displayUnit: 'pcs', unitMultiplier: 1 });
    const res = await get('/api/inventory', superTok);
    const item = res.body.items.find(i => i.itemCode === 'VEL-2');
    expect(item.thresholdIsAuto).toBe(false);
    expect(item.effectiveThreshold).toBe(25);
  });

  it('leaves autoThreshold at 0 for an item with no sales', async () => {
    const Inventory = mongoose.model('Inventory');
    await Inventory.create({ itemCode: 'VEL-3', itemName: 'Dead Stock Good', stockQty: 200, unit: 'pcs', unitCost: 5, displayUnit: 'pcs', unitMultiplier: 1 });
    const res = await get('/api/inventory', superTok);
    const item = res.body.items.find(i => i.itemCode === 'VEL-3');
    expect(item.autoThreshold).toBe(0);
    expect(item.thresholdIsAuto).toBe(false);
    expect(item.effectiveThreshold).toBe(0);
  });
});
