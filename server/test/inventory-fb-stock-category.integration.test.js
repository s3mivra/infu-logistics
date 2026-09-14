// fb stock categories: exported, and kept on import - separate from the menu.
//
// In fb, stock has its own categories (COFFEE & TEA, POWDERS, SYRUPS...), a
// different set from the menu's product categories. The inventory export
// carries them as header rows, the way the import sheet does, and importing
// them sets the item's stock category - without creating or touching a single
// menu product, which stays a logistics-only behaviour.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let app, stop, tok;

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'fb', jwtSecret: 'invcategory-fb-0123456789' }));
  await makeUser({ name: 'CafeBoss', role: 'superadmin', password: 'pw' });
  tok = await loginStaff(app, 'CafeBoss', 'pw');
}, 120000);

afterAll(async () => { await stop(); });

const H = () => ({ Authorization: `Bearer ${tok}` });

describe('fb stock categories', () => {
  it('exports them as header rows, linked through the item code', async () => {
    await mongoose.model('StockCategory').create({ name: 'COFFEE & TEA', prefix: 'G1', businessType: 'fb' });
    await mongoose.model('Inventory').create([
      { itemCode: 'G10001', itemName: 'BEANS PROFILE(2)', unit: 'g', businessType: 'fb' },
      { itemCode: 'G40001', itemName: 'ALASKA BARISTA MILK', unit: 'ml', stockCategory: 'OTHERS', businessType: 'fb' },
    ]);
    const res = await request(app).get('/api/export/inventory').set(H());
    expect(res.status).toBe(200);
    const col = (n) => res.body.columns.indexOf(n);
    expect(res.body.columns).toContain('Category');
    const headers = res.body.rows.filter(r => !r[col('Product')]).map(r => r[col('Code')]);
    expect(headers).toEqual(['COFFEE & TEA', 'OTHERS']);
    const beans = res.body.rows.find(r => r[col('Product')] === 'BEANS PROFILE(2)');
    expect(beans[col('Category')]).toBe('COFFEE & TEA');
    expect(beans[col('Category Source')]).toBe('Code prefix');
    for (const r of res.body.rows) expect(r).toHaveLength(res.body.columns.length);
  });

  it('keeps the stock category on import, and leaves the menu alone', async () => {
    const Product = mongoose.model('Product');
    const menuBefore = await Product.countDocuments({});
    const imp = await request(app).post('/api/inventory/import').set(H()).send({
      items: [
        { itemCode: 'G20001', itemName: 'DARK CHOCOLATE POWDER', displayUnit: 'kg', qty: 2, unitCost: 348.13, packSize: 1, srp: 348.13, category: 'POWDERS' },
        { itemCode: 'G30001', itemName: 'BODUO PASSIONFRUIT SYRUP', displayUnit: 'L', qty: 4, unitCost: 160, packSize: 2, category: 'SYRUPS & PUREE' },
      ],
    });
    expect(imp.status).toBe(200);
    const Inventory = mongoose.model('Inventory');
    expect((await Inventory.findOne({ itemCode: 'G20001' }).lean()).stockCategory).toBe('POWDERS');
    expect((await Inventory.findOne({ itemCode: 'G30001' }).lean()).stockCategory).toBe('SYRUPS & PUREE');
    // In fb the menu has its own categories; a stock import creates no products.
    expect(await Product.countDocuments({})).toBe(menuBefore);
    // The category is recorded with the prefix its codes imply, so the next
    // export can link new items to it by code.
    const cat = await mongoose.model('StockCategory').findOne({ name: 'POWDERS', businessType: 'fb' }).lean();
    expect(cat?.prefix).toBe('G2');
  });
});
