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

  it('next manual Add Inventory continues the imported sequence under the derived prefix', async () => {
    const res = await request(app).post('/api/inventory').set(auth(superToken)).send({
      itemName: 'Third Beans Item', unit: 'kg', stockQty: 1, unitCost: 500, stockCategory: 'BEANS',
    });
    expect(res.body.success).toBe(true);
    expect(res.body.item.itemCode).toBe('P10003'); // next after P10001/P10002
  });
});
