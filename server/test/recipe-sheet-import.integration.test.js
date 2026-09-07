// Importing a parsed recipe workbook, end to end.
//
// The complaint this covers: a sheet reading "12oz / 16oz Hot / Iced" with
// "260ml / 170ml Full Milk" used to arrive as ONE product with one recipe and
// no size at all - both milk figures folded together, so a 16oz iced drink
// consumed a hot 12oz's milk and the size field sat blank. The workbook is
// parsed into a draft here, and the draft is imported, so what an operator
// sees on the review screen is what lands on the product.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'ImportSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'ImportSuper');
}, 120000);

afterAll(async () => { await ctx.stop(); });

const M = (n) => mongoose.model(n);

beforeEach(async () => {
  for (const n of ['Inventory', 'Product', 'Category']) await M(n).deleteMany({});
  await M('Inventory').create([
    { itemCode: 'RM-MILK', itemName: 'Full Milk', unit: 'ml', stockQty: 50000, unitCost: 0.08, unitMultiplier: 1000 },
    { itemCode: 'RM-ESP', itemName: 'Espresso', unit: 'ml', stockQty: 5000, unitCost: 1, unitMultiplier: 1 },
  ]);
});

// Straight from the workbook: two volumes, two temperatures, and paired
// hot/iced quantities in the milk column.
const sheet = [
  [' INFU COFFEE ', '', '', '', '', ''],
  ['SIGNATURE COFFEE', 'CUP MARK', 'Size', 'Cups', 'Espresso', 'H20 & Milk'],
  ['LATTE', 'L', '12oz / 16oz Hot / Iced', 'DW / PET', '30ml', '260ml / 170ml Full Milk'],
];

const parse = () => auth('post', '/api/products/recipe-sheet/parse').send({ sheets: { 'DRINKS': sheet } });

describe('the draft the review screen is built from', () => {
  it('splits one row into a base size and an extra size', async () => {
    const { body } = await parse();
    const d = body.drafts.find(x => x.name === 'LATTE');
    expect(d.baseSizeName).toBe('12oz Hot');
    expect(d.sizes.map(s => s.name)).toEqual(['16oz Iced']);
  }, 30000);

  it('gives each size only its own milk', async () => {
    const { body } = await parse();
    const d = body.drafts.find(x => x.name === 'LATTE');
    const milk = (rows) => rows.find(r => /milk/i.test(r.name));
    expect(milk(d.baseRecipe).qty).toBe(260);
    expect(milk(d.sizes[0].recipe).qty).toBe(170);
    // The failure this prevents: both figures on one recipe.
    expect(d.baseRecipe.filter(r => /milk/i.test(r.name))).toHaveLength(1);
  }, 30000);

  it('carries no price, because the workbook has no price column', async () => {
    const { body } = await parse();
    expect(body.drafts[0].srp).toBeUndefined();
  }, 30000);
});

describe('importing that draft', () => {
  const importDraft = async (over = {}) => {
    const { body } = await parse();
    const d = body.drafts.find(x => x.name === 'LATTE');
    return auth('post', '/api/products/import-menu').send({
      rows: [{
        name: d.name, category: d.category, srp: 150,
        baseSize: d.baseSizeName,
        ingredients: d.baseRecipe,
        sizes: d.sizes.map(s => ({ ...s, price: 170 })),
        ...over,
      }],
    });
  };

  it('stores the quantities the sheet actually wrote', async () => {
    await importDraft();
    const p = await M('Product').findOne({ name: 'LATTE' }).lean();
    const milk = p.baseRecipe.find(r => /milk/i.test(r.name));
    expect(milk.qty).toBe(260);          // base units, not "1 kg"
    expect(milk.unit).toBe('L');         // the item's display unit, so the
                                         // editor reads 260 ml and not 260 L
    expect(milk.invId).toBeTruthy();     // linked to live stock
  }, 30000);

  it('fills in the size and its price', async () => {
    await importDraft();
    const p = await M('Product').findOne({ name: 'LATTE' }).lean();
    expect(p.baseSize).toBe('12oz Hot');
    expect(p.basePrice).toBe(150);
    expect(p.sizes).toHaveLength(1);
    expect(p.sizes[0].name).toBe('16oz Iced');
    expect(p.sizes[0].price).toBe(170);
    expect(p.sizes[0].recipe.find(r => /milk/i.test(r.name)).qty).toBe(170);
  }, 30000);

  it('creates the category, so the product is not filed under one that does not exist', async () => {
    const res = await importDraft();
    expect(res.body.createdCategories).toContain('SIGNATURE COFFEE');
    const cat = await M('Category').findOne({ name: 'SIGNATURE COFFEE' }).lean();
    expect(cat).toBeTruthy();
  }, 30000);

  it('does not create the same category twice on re-import', async () => {
    await importDraft();
    await importDraft();
    expect(await M('Category').countDocuments({ name: 'SIGNATURE COFFEE' })).toBe(1);
  }, 30000);

  it('leaves hand-made sizes alone when the import carries none', async () => {
    await importDraft();
    await auth('post', '/api/products/import-menu').send({
      rows: [{ name: 'LATTE', category: 'SIGNATURE COFFEE', srp: 150, ingredients: [] }],
    });
    const p = await M('Product').findOne({ name: 'LATTE' }).lean();
    expect(p.sizes).toHaveLength(1);
  }, 30000);
});
