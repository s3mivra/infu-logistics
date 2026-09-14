// Export, then import that export: the stock must come back the same.
//
// "We are just moving data" - an export that cannot be imported is a report,
// not a way to move anything. This exports inventory, reads the rows with the
// same conversion the Inventory tab's Import applies, wipes
// the stock, imports, and compares what was stored. It runs the importer's
// real row-reading code (client/src/shared/importSheets.js), not a copy.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let app, stop, tok;

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'fb', jwtSecret: 'roundtrip-secret-0123456789' }));
  await makeUser({ name: 'MoveBoss', role: 'superadmin', password: 'pw' });
  tok = await loginStaff(app, 'MoveBoss', 'pw');
}, 120000);

afterAll(async () => { await stop(); });

const H = () => ({ Authorization: `Bearer ${tok}` });

// ── The importer's own code ───────────────────────────────────────────────
// Not a copy: this is the module the Inventory tab's Import runs, so the test
// fails the moment the real conversion stops matching the export.
import {
  normaliseInventoryRow, isCategoryHeaderCode, inventoryImportPayload,
} from '../../client/src/shared/importSheets.js';

// The export's rows as sheet_to_json would read them back out of the file:
// one object per row, keyed by header.
const asSheetObjects = (columns, rows) => rows.map(r => Object.fromEntries(columns.map((c, i) => [c, r[i]])));

// Exactly the import's preview pass: normalise each row, let a Code-only row
// set the category for the rows after it.
const asImportItems = (columns, rows) => {
  let currentCategory = '';
  const items = [];
  for (const raw of asSheetObjects(columns, rows)) {
    const r = normaliseInventoryRow(raw);
    if (!r.itemName) {
      if (isCategoryHeaderCode(r.itemCode)) currentCategory = r.itemCode;
      continue;
    }
    items.push({ ...r, category: currentCategory });
  }
  return inventoryImportPayload(items).items;
};

describe('inventory export -> import round trip', () => {
  it('brings every item back with the same quantity, cost, pack and price', async () => {
    const Inventory = mongoose.model('Inventory');
    await Inventory.create([
      { itemCode: 'G10001', itemName: 'BEANS PROFILE(2)', unit: 'g', displayUnit: 'kg', unitMultiplier: 1000,
        packSize: 1, unitCost: 0.386, stockQty: 3000, srp: 450, lowStockThreshold: 500, stockLocation: 'Main bar',
        stockCategory: 'COFFEE & TEA', businessType: 'fb' },
      // A cost that is not a round number per pack - blended across deliveries.
      { itemCode: 'G40005', itemName: 'ALASKA CONDENSED', unit: 'g', displayUnit: 'kg', unitMultiplier: 1000,
        packSize: 0.377, unitCost: 65.8734 / 377, stockQty: 1131, businessType: 'fb' },
      { itemCode: 'G30009', itemName: 'ROASTED ALMOND', unit: 'ml', displayUnit: 'L', unitMultiplier: 1000,
        packSize: 0.75, unitCost: 470 / 750, stockQty: 1500, businessType: 'fb' },
      { itemCode: 'G40007', itemName: 'STRAW SMALL', unit: 'pcs', displayUnit: 'pcs', unitMultiplier: 1,
        packSize: 100, unitCost: 0.45, stockQty: 250, businessType: 'fb' },
      { itemCode: 'G80004', itemName: 'DRIED STRAWBERRY', unit: 'pcs', displayUnit: 'pcs', unitMultiplier: 1,
        packSize: null, unitCost: 369, stockQty: 4, businessType: 'fb' },
      { itemCode: 'G80001', itemName: 'COCONUT JELLY', unit: 'g', displayUnit: 'kg', unitMultiplier: 1000,
        packSize: null, unitCost: 0.07, stockQty: 2500, businessType: 'fb' },
    ]);

    const before = await Inventory.find({}).lean();
    const exp = await request(app).get('/api/export/inventory').set(H());
    expect(exp.status).toBe(200);
    const items = asImportItems(exp.body.columns, exp.body.rows);

    await Inventory.deleteMany({});
    const imp = await request(app).post('/api/inventory/import').set(H()).send({ items });
    expect(imp.status).toBe(200);
    expect(imp.body.summary.errors).toEqual([]);

    const after = Object.fromEntries((await Inventory.find({}).lean()).map(i => [i.itemCode, i]));
    for (const b of before) {
      const a = after[b.itemCode];
      expect(a, `${b.itemCode} came back`).toBeTruthy();
      expect(a.itemName).toBe(b.itemName);
      expect(a.unit).toBe(b.unit);
      expect(a.stockQty).toBeCloseTo(b.stockQty, 6);
      expect(a.unitCost).toBeCloseTo(b.unitCost, 9);
      if (b.packSize) expect(a.packSize).toBeCloseTo(b.packSize, 9);
      else expect(a.packSize ?? null).toBe(null);
      if (b.srp) expect(a.srp).toBe(b.srp);
      // These used to be lost: the importer had no way to take them back.
      expect(a.lowStockThreshold || 0).toBe(b.lowStockThreshold || 0);
      expect(a.stockLocation || '').toBe(b.stockLocation || '');
      // Carried as a header row and restored as the item's stock category -
      // an fb import used to throw it away.
      expect(a.stockCategory || '').toBe(b.stockCategory || '');
    }
  });

  it('keeps each expiry lot as its own lot', async () => {
    const Inventory = mongoose.model('Inventory');
    await Inventory.deleteMany({});
    await Inventory.create({
      itemCode: 'G40001', itemName: 'ALASKA BARISTA MILK', unit: 'ml', displayUnit: 'L', unitMultiplier: 1000,
      packSize: 1, unitCost: 0.08, stockQty: 3000, businessType: 'fb',
      expiryBatches: [
        { qty: 1000, expiryDate: new Date('2026-12-01'), unitCost: 0.08 },
        { qty: 2000, expiryDate: new Date('2027-01-15'), unitCost: 0.08 },
      ],
      expiryDate: new Date('2026-12-01'),
    });

    const exp = await request(app).get('/api/export/inventory').set(H());
    const items = asImportItems(exp.body.columns, exp.body.rows);
    // One row per lot, not one row at the soonest date.
    expect(items.filter(i => i.itemCode === 'G40001').map(i => i.expiryDate)).toEqual(['2026-12-01', '2027-01-15']);

    await Inventory.deleteMany({});
    const imp = await request(app).post('/api/inventory/import').set(H()).send({ items });
    expect(imp.status).toBe(200);

    const back = await Inventory.findOne({ itemCode: 'G40001' }).lean();
    expect(back.stockQty).toBeCloseTo(3000, 6);
    const dates = back.expiryBatches.map(b => new Date(b.expiryDate).toISOString().slice(0, 10)).sort();
    expect(dates).toEqual(['2026-12-01', '2027-01-15']);
  });
});
