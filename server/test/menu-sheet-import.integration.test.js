// Importing the coded menu sheet, end to end.
//
// The sheet names ingredients by stock code, so what lands in a recipe depends
// on what exists in Inventory. This checks the whole journey: sheet rows in,
// products with per-size recipes out, linked to the right stock at the right
// quantities - and the lines it could not read left out rather than guessed.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const M = (n) => mongoose.model(n);

const row = (name, size, pairs, price) => {
  const r = [name, size];
  for (let i = 0; i < 6; i++) { r.push(pairs[i]?.[0] ?? '', pairs[i]?.[1] ?? ''); }
  r.push(price);
  return r;
};
const HEADER = ['Category & Name', 'Base & Extra Size', 'Ingredients', '', '', '', '', '', '', '', '', '', '', '', 'Price'];
const CATEGORY = (n) => [n, ...Array(14).fill('')];

const SHEET = [
  HEADER,
  CATEGORY('Specialty Black & White'),
  // "1/1" for the cup and lid, as Excel mangled it into a date.
  row('Long Black', '8oz Hot', [['G60004/G60008', 46023], ['G10002/Water', '20g/35ml']], 100),
  row('', '12oz Iced', [['G60004/G60008', 46023], ['G10002/Water', '20g/35ml'], ['Ice', '100g']], 120),
];

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'MenuSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'MenuSuper');
}, 120000);

afterAll(async () => { await ctx.stop(); });

beforeEach(async () => {
  await Promise.all([M('Product').deleteMany({}), M('Inventory').deleteMany({}), M('Category').deleteMany({})]);
  // Beans tracked in grams; cups in pieces. G60008 (lids) deliberately absent.
  await M('Inventory').create([
    { itemCode: 'G10002', itemName: 'Espresso Beans', unit: 'g', displayUnit: 'kg', unitMultiplier: 1000, stockQty: 5000, unitCost: 1.2 },
    { itemCode: 'G60004', itemName: '8oz Hot Cup', unit: 'pcs', displayUnit: 'pcs', unitMultiplier: 1, stockQty: 500, unitCost: 3 },
  ]);
});

const parse = () => auth('post', '/api/products/menu-sheet/parse').send({ rows: SHEET });

describe('reading the sheet', () => {
  it('reports what it found without writing anything', async () => {
    const res = await parse();
    expect(res.body.success).toBe(true);
    expect(res.body.counts.products).toBe(1);
    expect(res.body.counts.sizes).toBe(2);
    expect(await M('Product').countDocuments({})).toBe(0);
  });

  it('says which lines found stock and which did not', async () => {
    const { body } = await parse();
    // G10002 and G60004 exist; G60008, Water and Ice do not.
    expect(body.nonStockNames).toEqual(expect.arrayContaining(['G60008', 'Water', 'Ice']));
    expect(body.counts.stockLines).toBeGreaterThan(0);
  });
});

describe('importing it', () => {
  const commit = async () => {
    const { body } = await parse();
    const rows = body.products.map(p => ({
      name: p.name, srp: p.srp, category: p.category, baseSize: p.baseSize, ingredients: p.ingredients,
      sizes: p.sizes.map(sz => ({ name: sz.name, price: sz.price, ingredients: sz.ingredients })),
    }));
    return auth('post', '/api/products/import-menu').send({ rows });
  };

  it('makes the first row the base size and the rest extras', async () => {
    const res = await commit();
    expect(res.body.success).toBe(true);

    const p = await M('Product').findOne({ name: 'Long Black' }).lean();
    expect(p.category).toBe('Specialty Black & White');
    // The register lists the base size and then the extras. Repeating the first
    // row in both would show "8oz Hot" on the menu twice.
    expect(p.baseSize).toBe('8oz Hot');
    expect(p.basePrice).toBe(100);
    expect(p.sizes.map(s => s.name)).toEqual(['12oz Iced']);
    expect(p.sizes.map(s => s.price)).toEqual([120]);
  });

  it('links an ingredient by its stock code, in base units', async () => {
    await commit();
    const p = await M('Product').findOne({ name: 'Long Black' }).lean();
    const beans = p.baseRecipe.find(r => r.name === 'Espresso Beans');

    expect(beans.invId).toBeTruthy();         // matched on G10002, not by name
    expect(beans.qty).toBe(20);               // 20 g, stored in base units
    expect(beans.nonStock).toBeFalsy();
  });

  it('counts a unitless quantity as one piece', async () => {
    await commit();
    const p = await M('Product').findOne({ name: 'Long Black' }).lean();
    const cup = p.baseRecipe.find(r => r.name === '8oz Hot Cup');
    // "1/1" survived Excel turning it into a date.
    expect(cup.qty).toBe(1);
  });

  it('records what is not stock without deducting or costing it', async () => {
    await commit();
    const p = await M('Product').findOne({ name: 'Long Black' }).lean();
    const water = p.baseRecipe.find(r => r.name === 'Water');

    expect(water.nonStock).toBe(true);
    expect(water.qty).toBe(35);
    expect(water.unit).toBe('ml');
    expect(water.cost).toBe(0);
    expect(water.invId).toBeFalsy();
  });

  it("keeps each size's own recipe", async () => {
    await commit();
    const p = await M('Product').findOne({ name: 'Long Black' }).lean();
    // Ice belongs to the iced size alone.
    expect(p.baseRecipe.some(r => r.name === 'Ice')).toBe(false);
    expect(p.sizes[0].recipe.some(r => r.name === 'Ice')).toBe(true);
  });
});

describe('a sheet the reader cannot make sense of', () => {
  it('reports the row instead of guessing which quantity belongs to what', async () => {
    const res = await auth('post', '/api/products/menu-sheet/parse').send({
      rows: [HEADER, CATEGORY('Matcha'), row('Seasalt Einspanner', '12oz Iced', [['Water', '40ml/40ml']], 180)],
    });
    expect(res.body.counts.needingReview).toBe(1);
    expect(res.body.problems[0].problems[0].kind).toBe('count-mismatch');
    // The unreadable line is left out rather than half-imported. That row is
    // the drink's only one, so it is the base size.
    expect(res.body.products[0].ingredients).toHaveLength(0);
  });
});

// The editor shows a product's base materials separately from each size. It was
// coming through empty, which is not only odd to look at: a sale that names no
// size falls back to the base recipe, and an empty one deducts no stock and
// books no cost.
describe('the base recipe after import', () => {
  it('carries the first size, so a sale with no size still costs something', async () => {
    const { body } = await auth('post', '/api/products/menu-sheet/parse').send({ rows: SHEET });
    const rows = body.products.map(p => ({
      name: p.name, srp: p.srp, category: p.category, ingredients: p.ingredients,
      sizes: p.sizes.map(sz => ({ name: sz.name, price: sz.price, ingredients: sz.ingredients })),
    }));
    await auth('post', '/api/products/import-menu').send({ rows });

    const p = await M('Product').findOne({ name: 'Long Black' }).lean();
    expect(p.baseRecipe.length).toBeGreaterThan(0);

    const beans = p.baseRecipe.find(r => r.name === 'Espresso Beans');
    expect(beans.qty).toBe(20);
    // The 8oz hot row is first, so the base is the hot recipe - no ice.
    expect(p.baseRecipe.some(r => r.name === 'Ice')).toBe(false);
    expect(p.sizes[0].recipe.some(r => r.name === 'Ice')).toBe(true);
  });
});
