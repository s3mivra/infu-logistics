// Export the menu, then import that export: the recipes must come back the same.
//
// This exports Recipes, reads the rows with Menu Setup's own import code
// (client/src/shared/importSheets.js), deletes the menu, imports, and compares. The cases that used to go wrong on the way back:
// filtered water was "unmatched" and silently dropped; sizes were never sent;
// and add-on lines would have been folded into the base recipe.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let app, stop, tok;

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'fb', jwtSecret: 'menu-roundtrip-0123456789' }));
  await makeUser({ name: 'MenuMover', role: 'superadmin', password: 'pw' });
  tok = await loginStaff(app, 'MenuMover', 'pw');
}, 120000);

afterAll(async () => { await stop(); });

const H = () => ({ Authorization: `Bearer ${tok}` });

// The importer's own code, not a copy: Menu Setup's Import groups rows and
// builds its upload with exactly these functions.
import { groupMenuRows, menuImportPayload } from '../../client/src/shared/importSheets.js';

const asSheetObjects = (columns, rows) => rows.map(r => Object.fromEntries(columns.map((c, i) => [c, r[i]])));

// Same filter as submitMenuImport, then the shared payload builder.
const asMenuPayload = (columns, rows) => {
  const grouped = groupMenuRows(asSheetObjects(columns, rows));
  return menuImportPayload(grouped.filter(r => r.name && r.srp >= 0));
};

describe('menu export -> import round trip', () => {
  it('brings recipes, sizes and filtered water back, and keeps add-ons out of the base', async () => {
    const Inventory = mongoose.model('Inventory');
    const Product = mongoose.model('Product');
    const [beans, milk] = await Inventory.create([
      { itemCode: 'G10001', itemName: 'BEANS PROFILE(2)', unit: 'g', displayUnit: 'kg', unitMultiplier: 1000,
        packSize: 1, unitCost: 0.386, stockQty: 5000, businessType: 'fb' },
      { itemCode: 'G40001', itemName: 'ALASKA BARISTA MILK', unit: 'ml', displayUnit: 'L', unitMultiplier: 1000,
        packSize: 1, unitCost: 0.08, stockQty: 10000, businessType: 'fb' },
    ]);
    await Product.create({
      name: 'Latte', category: 'Coffee', basePrice: 150, businessType: 'fb',
      baseRecipe: [
        { invId: String(beans._id), name: 'BEANS PROFILE(2)', qty: 18, cost: 0.386, packBase: 1000 },
        { invId: String(milk._id), name: 'ALASKA BARISTA MILK', qty: 150, cost: 0.08, packBase: 1000 },
        { name: 'FILTERED WATER', qty: 200, cost: 0, unit: 'ml', nonStock: true },
      ],
      sizes: [{ name: '16oz', price: 170, recipe: [
        { invId: String(milk._id), name: 'ALASKA BARISTA MILK', qty: 200, cost: 0.08, packBase: 1000 },
        { name: 'FILTERED WATER', qty: 250, cost: 0, unit: 'ml', nonStock: true },
      ] }],
      addOns: [{ name: 'Extra Shot', price: 30, recipe: [{ invId: String(beans._id), name: 'BEANS PROFILE(2)', qty: 9, cost: 0.386 }] }],
    });

    const exp = await request(app).get('/api/export/recipes').set(H());
    expect(exp.status).toBe(200);
    const payload = asMenuPayload(exp.body.columns, exp.body.rows);

    await Product.deleteMany({});
    const imp = await request(app).post('/api/products/import-menu').set(H()).send(payload);
    expect(imp.status).toBe(200);
    expect(imp.body.success).toBe(true);
    expect((imp.body.results || []).filter(r => !r.ok)).toEqual([]);

    const back = await Product.findOne({ name: 'Latte' }).lean();
    expect(back.basePrice).toBe(150);
    expect(back.category).toBe('Coffee');

    const base = Object.fromEntries(back.baseRecipe.map(l => [l.name, l]));
    // Exactly the three base lines - the add-on's 9g of beans must NOT be here.
    expect(back.baseRecipe).toHaveLength(3);
    expect(base['BEANS PROFILE(2)'].qty).toBeCloseTo(18, 9);
    expect(base['ALASKA BARISTA MILK'].qty).toBeCloseTo(150, 9);
    // Filtered water survives as non-stock, not dropped as "unmatched".
    expect(base['FILTERED WATER'].nonStock).toBe(true);
    expect(base['FILTERED WATER'].qty).toBe(200);

    expect(back.sizes).toHaveLength(1);
    expect(back.sizes[0].name).toBe('16oz');
    expect(back.sizes[0].price).toBe(170);
    const sz = Object.fromEntries(back.sizes[0].recipe.map(l => [l.name, l]));
    expect(sz['ALASKA BARISTA MILK'].qty).toBeCloseTo(200, 9);
    expect(sz['FILTERED WATER'].nonStock).toBe(true);
  });
});
