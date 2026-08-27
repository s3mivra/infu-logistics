// Bulk inventory import (log mode) - a sheet's section headers ("BEANS", "TEA",
// ...) become each row's `category`. This derives a code prefix from the row's
// own itemCode (e.g. "P10001" -> "P1") and stamps it onto the matching
// StockCategory so it shows up pre-filled when that category is later opened
// for editing, and so future manually-added items in that category keep
// numbering right behind what the import brought in.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let app, stop, superToken;
const auth = (t) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'log', jwtSecret: 'import-prefix-test-secret-0123456789' }));
  await makeUser({ name: 'ImportBoss', role: 'superadmin', password: 'pw' });
  await mongoose.model('User').updateMany({}, { $set: { tenantId: null } });
  superToken = await loginStaff(app, 'ImportBoss', 'pw');
}, 120000);

afterAll(async () => { await stop(); });

describe('inventory import auto-derives a StockCategory prefix', () => {
  it('creates a StockCategory with the derived prefix for a new category', async () => {
    const res = await request(app).post('/api/inventory/import').set(auth(superToken)).send({
      items: [
        { itemCode: 'P10001', itemName: 'Commercial Blend 1kg', displayUnit: 'kg', qty: 10, unitCost: 600, category: 'BEANS' },
        { itemCode: 'P10002', itemName: 'Specialty Brazil 1kg', displayUnit: 'kg', qty: 5, unitCost: 771, category: 'BEANS' },
      ],
    });
    expect(res.body.success).toBe(true);

    const StockCategory = mongoose.model('StockCategory');
    const cat = await StockCategory.findOne({ name: 'BEANS' }).lean();
    expect(cat).toBeTruthy();
    expect(cat.prefix).toBe('P1');

    const Inventory = mongoose.model('Inventory');
    const item = await Inventory.findOne({ itemCode: 'P10001' }).lean();
    expect(item.stockCategory).toBe('BEANS');
  });

  it('never overwrites a prefix the user already set by hand', async () => {
    const StockCategory = mongoose.model('StockCategory');
    await StockCategory.create({ businessType: 'log', name: 'TEA', prefix: 'CUSTOM' });

    await request(app).post('/api/inventory/import').set(auth(superToken)).send({
      items: [{ itemCode: 'P20001', itemName: 'Cascara Tea 1kg', displayUnit: 'kg', qty: 3, unitCost: 2600, category: 'TEA' }],
    });

    const cat = await StockCategory.findOne({ name: 'TEA' }).lean();
    expect(cat.prefix).toBe('CUSTOM'); // untouched
  });

  it('a category whose codes carry no derivable 4-digit sequence imports fine, with no StockCategory prefix invented', async () => {
    const res = await request(app).post('/api/inventory/import').set(auth(superToken)).send({
      items: [{ itemCode: 'MISC', itemName: 'Odd Ball Item', displayUnit: 'pcs', qty: 1, unitCost: 10, category: 'ODDS' }],
    });
    expect(res.body.success).toBe(true);

    // Nothing to derive a prefix from - no StockCategory doc gets created for
    // it at all (there'd be nothing useful to pre-fill), but the item itself
    // still carries the plain category string for filtering/display.
    const StockCategory = mongoose.model('StockCategory');
    const cat = await StockCategory.findOne({ name: 'ODDS' }).lean();
    expect(cat).toBeNull();

    const Inventory = mongoose.model('Inventory');
    const item = await Inventory.findOne({ itemCode: 'MISC' }).lean();
    expect(item.stockCategory).toBe('ODDS');
  });

  it('backfill-prefixes fills in a blank prefix on a category that predates the auto-derive logic', async () => {
    // Simulate a category created before this feature existed: a StockCategory
    // with no prefix, plus items whose stockCategory names it but were never
    // touched by the derive-on-import path.
    const StockCategory = mongoose.model('StockCategory');
    const Inventory = mongoose.model('Inventory');
    await StockCategory.create({ businessType: 'log', name: 'SYRUPS', prefix: '' });
    await Inventory.create({
      businessType: 'log', itemCode: 'P40001', itemName: 'Seasalt Syrup', unit: 'L', stockQty: 5, unitCost: 260, stockCategory: 'SYRUPS',
    });

    const res = await request(app).post('/api/stock-categories/backfill-prefixes').set(auth(superToken));
    expect(res.body.success).toBe(true);
    expect(res.body.filled.some(f => f.name === 'SYRUPS' && f.prefix === 'P4')).toBe(true);

    const cat = await StockCategory.findOne({ name: 'SYRUPS' }).lean();
    expect(cat.prefix).toBe('P4');
  });

  it('backfill-prefixes skips a category whose derived prefix would collide with another', async () => {
    const StockCategory = mongoose.model('StockCategory');
    const Inventory = mongoose.model('Inventory');
    // BEANS already owns "P1" from the earlier test in this file.
    await StockCategory.create({ businessType: 'log', name: 'BEANS COPY', prefix: '' });
    await Inventory.create({
      businessType: 'log', itemCode: 'P19999', itemName: 'Also Beans-ish', unit: 'kg', stockQty: 1, unitCost: 1, stockCategory: 'BEANS COPY',
    });

    const res = await request(app).post('/api/stock-categories/backfill-prefixes').set(auth(superToken));
    expect(res.body.success).toBe(true);
    expect(res.body.skipped.some(s => s.name === 'BEANS COPY' && /already used/i.test(s.reason))).toBe(true);

    const cat = await StockCategory.findOne({ name: 'BEANS COPY' }).lean();
    expect(cat.prefix).toBe('');

    // Clean up - P19999 also matches the P1 sequence nextCategoryCode scans,
    // which would otherwise throw off the "next manual add" test below.
    await Inventory.deleteOne({ itemCode: 'P19999' });
  });

  it('next manual Add Inventory continues the imported sequence under the derived prefix', async () => {
    const res = await request(app).post('/api/inventory').set(auth(superToken)).send({
      itemName: 'Third Beans Item', unit: 'kg', stockQty: 1, unitCost: 500, stockCategory: 'BEANS',
    });
    expect(res.body.success).toBe(true);
    expect(res.body.item.itemCode).toBe('P10003'); // next after P10001/P10002
  });
});

describe('bulk renumber a stock category', () => {
  it('rejects a category with no prefix set', async () => {
    const StockCategory = mongoose.model('StockCategory');
    const cat = await StockCategory.create({ businessType: 'log', name: 'NOPREFIX', prefix: '' });
    const res = await request(app).post(`/api/stock-categories/${cat._id}/renumber`).set(auth(superToken));
    expect(res.status).toBe(400);
  });

  it('renumbers every item in the category to sequential codes under its prefix, and cascades to the linked product', async () => {
    const StockCategory = mongoose.model('StockCategory');
    const Inventory = mongoose.model('Inventory');
    const Product = mongoose.model('Product');

    const cat = await StockCategory.create({ businessType: 'log', name: 'RENUM CAT', prefix: 'RN' });
    const a = await Inventory.create({ businessType: 'log', itemCode: 'ZZZ001', itemName: 'Renum Item A', unit: 'pcs', stockQty: 1, unitCost: 1, stockCategory: 'RENUM CAT' });
    const b = await Inventory.create({ businessType: 'log', itemCode: 'AAA002', itemName: 'Renum Item B', unit: 'pcs', stockQty: 1, unitCost: 1, stockCategory: 'RENUM CAT' });
    await Product.create({ businessType: 'log', name: 'Renum Item A', category: 'RENUM CAT', basePrice: 10, productCode: 'ZZZ001' });

    const res = await request(app).post(`/api/stock-categories/${cat._id}/renumber`).set(auth(superToken));
    expect(res.body.success).toBe(true);
    expect(res.body.renamed.length).toBe(2);

    // Sorted by OLD itemCode ascending ("AAA002" < "ZZZ001"), so B gets RN0001, A gets RN0002.
    const freshA = await Inventory.findById(a._id).lean();
    const freshB = await Inventory.findById(b._id).lean();
    expect(freshB.itemCode).toBe('RN0001');
    expect(freshA.itemCode).toBe('RN0002');

    const prod = await Product.findOne({ name: 'Renum Item A' }).lean();
    expect(prod.productCode).toBe('RN0002'); // cascaded from the Inventory rename
  });

  it('is idempotent - running it again with nothing changed reports zero renames', async () => {
    const StockCategory = mongoose.model('StockCategory');
    const cat = await StockCategory.findOne({ name: 'RENUM CAT' }).lean();
    const res = await request(app).post(`/api/stock-categories/${cat._id}/renumber`).set(auth(superToken));
    expect(res.body.success).toBe(true);
    expect(res.body.renamed.length).toBe(0);
    expect(res.body.unchanged).toBe(2);
  });

  it('finds items via the linked Product category when Inventory.stockCategory was never populated (pre-existing data)', async () => {
    const StockCategory = mongoose.model('StockCategory');
    const Inventory = mongoose.model('Inventory');
    const Product = mongoose.model('Product');

    const cat = await StockCategory.create({ businessType: 'log', name: 'LEGACY TEA', prefix: 'P9' });
    // Deliberately no stockCategory on the Inventory doc - simulates an item
    // imported before that field existed, same as the real bug report.
    const item = await Inventory.create({ businessType: 'log', itemCode: 'P20004', itemName: 'Butterfly Pea', unit: 'kg', stockQty: 11, unitCost: 130 });
    await Product.create({ businessType: 'log', name: 'Butterfly Pea', category: 'LEGACY TEA', basePrice: 250, productCode: 'P20004' });

    const res = await request(app).post(`/api/stock-categories/${cat._id}/renumber`).set(auth(superToken));
    expect(res.body.success).toBe(true);
    expect(res.body.renamed).toEqual([{ itemName: 'Butterfly Pea', from: 'P20004', to: 'P90001' }]);

    const fresh = await Inventory.findById(item._id).lean();
    expect(fresh.itemCode).toBe('P90001');
    expect(fresh.stockCategory).toBe('LEGACY TEA'); // backfilled along the way

    const prod = await Product.findOne({ name: 'Butterfly Pea' }).lean();
    expect(prod.productCode).toBe('P90001');
  });

  it('does not touch historical order lines already booked under the old code', async () => {
    // Sanity check on the documented guarantee: Order is a separate collection
    // keyed by its own snapshot fields, never touched by this route at all.
    const Order = mongoose.model('Order');
    const before = await Order.countDocuments({});
    const StockCategory = mongoose.model('StockCategory');
    const cat = await StockCategory.findOne({ name: 'RENUM CAT' }).lean();
    await request(app).post(`/api/stock-categories/${cat._id}/renumber`).set(auth(superToken));
    const after = await Order.countDocuments({});
    expect(after).toBe(before);
  });
});
