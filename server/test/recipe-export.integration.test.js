// Menu exports that can actually be checked - and imported back.
//
// The products export used to say a drink had "3" recipe lines and nothing
// more. It now carries recipe cost and margin priced on today's ingredient
// costs. The Recipes export lists every line in Menu Setup's own import shape,
// with its quantity in packs as well as storage units - which is what makes a
// recipe that reset to one whole pack per drink visible at a glance.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let app, stop, tok;

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'fb', jwtSecret: 'recipe-export-0123456789' }));
  await makeUser({ name: 'MenuBoss', role: 'superadmin', password: 'pw' });
  tok = await loginStaff(app, 'MenuBoss', 'pw');

  const Inventory = mongoose.model('Inventory');
  const [beans, milk] = await Inventory.create([
    // Beans are now P386/kg; the recipe line below still carries the old
    // snapshot cost of 0.1/g, so a correct export must NOT use the snapshot.
    { itemCode: 'G10001', itemName: 'BEANS PROFILE(2)', unit: 'g', displayUnit: 'kg', unitMultiplier: 1000,
      packSize: 1, unitCost: 0.386, stockQty: 5000, businessType: 'fb' },
    { itemCode: 'G40001', itemName: 'ALASKA BARISTA MILK', unit: 'ml', displayUnit: 'L', unitMultiplier: 1000,
      packSize: 1, unitCost: 0.08, stockQty: 10000, businessType: 'fb' },
  ]);

  await mongoose.model('Product').create([
    {
      productCode: 'LAT-1', name: 'Latte', category: 'Coffee', basePrice: 150, businessType: 'fb',
      baseRecipe: [
        { invId: String(beans._id), name: 'BEANS PROFILE(2)', qty: 18, cost: 0.1, unit: '1kg', packBase: 1000 },
        { invId: String(milk._id), name: 'ALASKA BARISTA MILK', qty: 150, cost: 0.08, unit: '1L', packBase: 1000 },
        { name: 'FILTERED WATER', qty: 200, cost: 0, unit: 'ml', nonStock: true },
        // A stock item that has since been deleted.
        { invId: String(new mongoose.Types.ObjectId()), name: 'GHOST SYRUP', qty: 10, cost: 2, unit: 'ml' },
      ],
      sizes: [{ name: '16oz', price: 170, recipe: [{ invId: String(milk._id), name: 'ALASKA BARISTA MILK', qty: 200, cost: 0.08, unit: '1L', packBase: 1000 }] }],
      addOns: [{ name: 'Extra Shot', price: 30, recipe: [{ invId: String(beans._id), name: 'BEANS PROFILE(2)', qty: 9, cost: 0.386 }] }],
    },
    // A menu that came in from the coded sheet. Its lines are written in the
    // unit stock is counted in, so one unit is one base unit - which is a
    // different thing from the size of the bag the beans are bought in.
    { productCode: 'IMP-1', name: 'Imported Latte', category: 'Coffee', basePrice: 150, businessType: 'fb',
      baseRecipe: [{ invId: String(beans._id), name: 'BEANS PROFILE(2)', qty: 18, cost: 0.386, unit: 'g', packBase: 1 }] },
    { productCode: 'ESP-0', name: 'Plain Espresso', category: 'Coffee', basePrice: 90, businessType: 'fb', baseRecipe: [] },
    { productCode: 'OLD-1', name: 'Retired Drink', category: 'Coffee', basePrice: 100, isArchived: true, businessType: 'fb',
      baseRecipe: [{ invId: String(milk._id), name: 'ALASKA BARISTA MILK', qty: 100, cost: 0.08 }] },
  ]);
}, 120000);

afterAll(async () => { await stop(); });

const get = (path) => request(app).get(path).set({ Authorization: `Bearer ${tok}` });

describe('products export', () => {
  it('prices the recipe on today\'s ingredient costs, not the snapshot on the line', async () => {
    const res = await get('/api/export/products');
    const col = (n) => res.body.columns.indexOf(n);
    const latte = res.body.rows.find(r => r[col('Product Code')] === 'LAT-1');
    // 18g x 0.386 + 150ml x 0.08 + missing line at its own 2/ml x 10 = 6.948 + 12 + 20.
    // Water is not stock and costs nothing.
    expect(latte[col('Recipe Cost')]).toBe(38.95);
    expect(latte[col('Margin %')]).toBe(74);
    expect(latte[col('Size Prices')]).toContain('16oz 170');
    expect(res.body.columns.slice(0, 3)).toEqual(['Product Code', 'Name', 'Category']);
    expect(latte[col('Recipe Lines')]).toBe(4);
  });
});

describe('recipes export', () => {
  const sheet = async () => {
    const res = await get('/api/export/recipes');
    expect(res.status).toBe(200);
    const col = (n) => res.body.columns.indexOf(n);
    return { rows: res.body.rows, col, columns: res.body.columns };
  };

  it('leads with exactly Menu Setup\'s import columns', async () => {
    const { columns } = await sheet();
    expect(columns.slice(0, 8)).toEqual(['Category', 'Product', 'SRP', 'Size', 'Ingredient', 'Qty', 'Unit', 'Stock Link']);
  });

  it('lists every line with its quantity in storage units and in packs', async () => {
    const { rows, col } = await sheet();
    const beans = rows.find(r => r[col('Product')] === 'Latte' && r[col('Ingredient')] === 'BEANS PROFILE(2)' && r[col('Recipe')] === 'Base');
    expect(beans[col('SRP')]).toBe(150);
    expect(beans[col('Size')]).toBe('');
    expect(beans[col('Qty')]).toBe(18);
    expect(beans[col('Unit')]).toBe('g');
    // 0.018 of a bag - a line reset to a whole pack would read 1 here.
    expect(beans[col('Qty (packs)')]).toBe(0.018);
    expect(beans[col('Pack')]).toBe('1kg');
    expect(beans[col('Stock Link')]).toBe('Linked');
    expect(beans[col('Line Cost')]).toBe(6.95);
  });

  it('counts an imported line against the bag, not against its own unit', async () => {
    const { rows, col } = await sheet();
    const line = rows.find(r => r[col('Product')] === 'Imported Latte');
    expect(line[col('Qty')]).toBe(18);
    expect(line[col('Unit')]).toBe('g');
    // The column beside it names a 1kg bag, so this has to be a fraction of
    // one. Reading the line's own packBase of 1 as a pack size said "18 packs".
    expect(line[col('Pack')]).toBe('1kg');
    expect(line[col('Qty (packs)')]).toBe(0.018);
  });

  it('puts size lines under their size, at the size price', async () => {
    const { rows, col } = await sheet();
    const sizeLine = rows.find(r => r[col('Size')] === '16oz');
    expect(sizeLine[col('SRP')]).toBe(170);
    expect(sizeLine[col('Qty')]).toBe(200);
    expect(sizeLine[col('Qty (packs)')]).toBe(0.2);
  });

  it('marks non-stock and missing lines instead of hiding them', async () => {
    const { rows, col } = await sheet();
    const water = rows.find(r => r[col('Ingredient')] === 'FILTERED WATER');
    expect(water[col('Stock Link')]).toBe('Not from inventory');
    expect(water[col('Unit')]).toBe('ml');
    expect(water[col('Line Cost')]).toBe(0);
    const ghost = rows.find(r => r[col('Ingredient')] === 'GHOST SYRUP');
    expect(ghost[col('Stock Link')]).toMatch(/^Missing/);
    expect(ghost[col('Line Cost')]).toBe(20);
  });

  it('labels add-on lines so the importer can skip them', async () => {
    const { rows, col } = await sheet();
    const addOn = rows.find(r => r[col('Recipe')] === 'Add-on: Extra Shot');
    expect(addOn).toBeTruthy();
    expect(addOn[col('Size')]).toBe('');
  });

  it('still writes a row for a drink with no recipe, so its price comes back', async () => {
    const { rows, col } = await sheet();
    const plain = rows.find(r => r[col('Product')] === 'Plain Espresso');
    expect(plain[col('SRP')]).toBe(90);
    expect(plain[col('Ingredient')]).toBe('');
  });

  it('leaves archived products out', async () => {
    const { rows, col } = await sheet();
    expect(rows.some(r => r[col('Product')] === 'Retired Drink')).toBe(false);
  });
});
