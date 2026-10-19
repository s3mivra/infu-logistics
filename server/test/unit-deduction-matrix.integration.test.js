// Every kind of ingredient, from the stock form to the stock card.
//
// A sale deducts `recipe qty x quantity sold` straight off the recipe line,
// with no unit conversion at that point. So a sale is right exactly when a
// recipe line holds the same base unit stock is kept in - grams, millilitres,
// pieces - whatever the item is DISPLAYED or BOUGHT in.
//
// This walks the whole path for every kind of item a cafe keeps: counted loose,
// counted but bought in sleeves, weighed and shown in kg, weighed and bought in
// half-kilo bags, poured and shown in L, poured and bought in 750ml bottles,
// weighed and shown in grams. Items are created exactly as the Receive
// Inventory form creates them, the menu comes in through the coded sheet, and
// each sale is checked on the stock itself AND on the stock card, which must
// show what was deducted - one cup as -1, not as a fraction of a sleeve.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const M = (n) => mongoose.model(n);

// The Receive Inventory form's own payload for a new item: storage unit from
// the display unit, quantity and cost converted to that storage unit.
const UNIT = { pcs: { base: 'pcs', mult: 1 }, kg: { base: 'g', mult: 1000 }, g: { base: 'g', mult: 1 },
  L: { base: 'ml', mult: 1000 }, ml: { base: 'ml', mult: 1 } };
const receive = async ({ code, name, unit, packs, packSize, costPerPack }) => {
  const { base, mult } = UNIT[unit];
  const res = await auth('post', '/api/inventory').send({
    itemCode: code, itemName: name,
    stockQty: packs * packSize * mult,               // packs x pack size, in storage units
    unit: base, displayUnit: unit, unitMultiplier: mult,
    unitCost: costPerPack / packSize / mult,
    packSize, creditAccount: '111000',
  });
  expect(res.body.success).toBe(true);
  return res.body.item;
};

// What each drink uses, in the units the sheet is written in, and what that is
// in storage units.
const ITEMS = [
  { code: 'CUP8',  name: '8OZ HOT CUP',    unit: 'pcs', packs: 100, packSize: 50,   costPerPack: 150 },  // counted, bought in sleeves
  { code: 'STRAW', name: 'STRAWS',         unit: 'pcs', packs: 500, packSize: 1,    costPerPack: 1 },    // counted loose
  { code: 'BEAN',  name: 'ESPRESSO BEANS', unit: 'kg',  packs: 10,  packSize: 1,    costPerPack: 1200 }, // weighed, 1kg bags
  { code: 'CHOC',  name: 'DARK CHOCOLATE', unit: 'kg',  packs: 10,  packSize: 0.5,  costPerPack: 400 },  // weighed, 500g bags
  { code: 'MILK',  name: 'FRESH MILK',     unit: 'L',   packs: 20,  packSize: 1,    costPerPack: 95 },   // poured, 1L cartons
  { code: 'SYRP',  name: 'VANILLA SYRUP',  unit: 'L',   packs: 10,  packSize: 0.75, costPerPack: 450 },  // poured, 750ml bottles
  { code: 'CINN',  name: 'CINNAMON',       unit: 'g',   packs: 4,   packSize: 250,  costPerPack: 180 },  // weighed, shown in grams
];

// The coded sheet: name, size, six (codes, quantities) pairs, price.
const row = (name, size, pairs, price) => {
  const r = [name, size];
  for (let i = 0; i < 6; i++) r.push(pairs[i]?.[0] ?? '', pairs[i]?.[1] ?? '');
  r.push(price);
  return r;
};
const SHEET = [
  ['Category & Name', 'Base & Extra Size', 'Ingredients', '', '', '', '', '', '', '', '', '', '', '', 'Price'],
  ['Coffee', ...Array(14).fill('')],
  // The base: every unit as a cafe writes it, plus water, which is not stock.
  row('Test Latte', '8oz Hot', [
    ['CUP8/STRAW', '1/1'],
    ['BEAN/MILK', '20g/150ml'],
    ['CHOC/SYRP', '2g/10ml'],
    ['CINN/Water', '1g/35ml'],
  ], 130),
  // The size, written in kg and L on purpose: the sheet may say it either way.
  row('', '12oz Iced', [
    ['CUP8/STRAW', '1/2'],
    ['BEAN/MILK', '0.018kg/0.2L'],
    ['CHOC/SYRP', '3g/0.015L'],
    ['Ice', '100g'],
  ], 150),
];

// Storage units taken per drink, per item.
const BASE_USES = { CUP8: 1, STRAW: 1, BEAN: 20, CHOC: 2, MILK: 150, SYRP: 10, CINN: 1 };
const ICED_USES = { CUP8: 1, STRAW: 2, BEAN: 18, CHOC: 3, MILK: 200, SYRP: 15, CINN: 0 };

let items, product;
const stockOf = async (code) => (await M('Inventory').findOne({ itemCode: code }).lean()).stockQty;

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'Owner', role: 'superadmin' });
  tok = await loginStaff(app, 'Owner');

  items = {};
  for (const it of ITEMS) items[it.code] = await receive(it);

  const parsed = await auth('post', '/api/products/menu-sheet/parse').send({ rows: SHEET });
  expect(parsed.body.success).toBe(true);
  const rows = parsed.body.products.map(p => ({
    name: p.name, srp: p.srp, category: p.category, baseSize: p.baseSize, ingredients: p.ingredients,
    sizes: p.sizes.map(sz => ({ name: sz.name, price: sz.price, ingredients: sz.ingredients })),
  }));
  const imported = await auth('post', '/api/products/import-menu').send({ rows, replaceSizes: true });
  expect(imported.body.success).toBe(true);
  product = await M('Product').findOne({ name: 'Test Latte' }).lean();
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('stock, as the Receive form stores it', () => {
  it('keeps every item in grams, millilitres or pieces', () => {
    const want = { CUP8: ['pcs', 5000], STRAW: ['pcs', 500], BEAN: ['g', 10000], CHOC: ['g', 5000],
      MILK: ['ml', 20000], SYRP: ['ml', 7500], CINN: ['g', 1000] };
    for (const [code, [unit, qty]] of Object.entries(want)) {
      expect({ code, unit: items[code].unit, qty: items[code].stockQty }).toEqual({ code, unit, qty });
    }
  });
});

describe('the recipe, as the coded sheet writes it', () => {
  const byCode = (recipe) => Object.fromEntries(
    recipe.filter(l => l.invId).map(l => [Object.values(items).find(i => String(i._id) === String(l.invId)).itemCode, l]),
  );

  it('stores the base in storage units, labelled in storage units', () => {
    const lines = byCode(product.baseRecipe);
    for (const [code, qty] of Object.entries(BASE_USES)) {
      expect({ code, qty: lines[code].qty, unit: lines[code].unit, packBase: lines[code].packBase })
        .toEqual({ code, qty, unit: items[code].unit, packBase: 1 });
    }
  });

  it('converts a size written in kg and L into the same storage units', () => {
    const lines = byCode(product.sizes[0].recipe);
    for (const [code, qty] of Object.entries(ICED_USES)) {
      if (!qty) continue;
      expect({ code, qty: lines[code].qty }).toEqual({ code, qty });
    }
  });

  it('keeps water and ice as measured lines that are not stock', () => {
    expect(product.baseRecipe.find(l => l.name === 'Water')).toMatchObject({ qty: 35, unit: 'ml', nonStock: true });
    expect(product.sizes[0].recipe.find(l => l.name === 'Ice')).toMatchObject({ qty: 100, unit: 'g', nonStock: true });
  });
});

describe('a sale', () => {
  const sell = async (name, quantity) => {
    const placed = await auth('post', '/api/orders').send({
      table: 'Dine-In', paymentMethod: 'Cash', customerName: 'Walk-in',
      items: [{ productId: String(product._id), name, price: 130, quantity }],
    });
    expect(placed.body.success).toBe(true);
    await auth('put', `/api/orders/${placed.body.order._id}`).send({ status: 'Completed' });
    return placed.body.order;
  };
  const snapshot = async () => Object.fromEntries(await Promise.all(ITEMS.map(async i => [i.code, await stockOf(i.code)])));

  it('takes exactly what the base recipe says, for every unit', async () => {
    const before = await snapshot();
    const order = await sell('Test Latte', 1);
    const after = await snapshot();
    for (const [code, uses] of Object.entries(BASE_USES)) {
      expect({ code, taken: before[code] - after[code] }).toEqual({ code, taken: uses });
    }

    // And the stock card says the same: what was deducted, in storage units.
    // One cup is -1, not -0.02 of a sleeve; 20g of beans is -20, not -0.02 kg.
    const cards = await M('StockCard').find({ reference: new RegExp(order.orderNumber) }).lean();
    for (const [code, uses] of Object.entries(BASE_USES)) {
      const card = cards.find(c => String(c.inventoryId) === String(items[code]._id));
      expect({ code, qtyChange: card?.qtyChange }).toEqual({ code, qtyChange: -uses });
    }
  });

  it('takes the size\'s own recipe, times the number sold', async () => {
    const before = await snapshot();
    await sell('Test Latte (12oz Iced)', 2);
    const after = await snapshot();
    for (const [code, uses] of Object.entries(ICED_USES)) {
      expect({ code, taken: before[code] - after[code] }).toEqual({ code, taken: uses * 2 });
    }
  });

  it('never touches stock for what is not stock', async () => {
    // Water and ice have no inventory item, so there is nothing to deduct from
    // and nothing is invented to deduct them from.
    expect(await M('Inventory').countDocuments({ itemName: /^(WATER|ICE)$/i })).toBe(0);
  });
});

describe('restocking in packs', () => {
  it('adds pack count x pack size, which is what a delivery actually is', async () => {
    // Two sleeves of fifty cups is a hundred cups. This is the arithmetic the
    // Receive form sends when an existing item is restocked.
    const before = await stockOf('CUP8');
    const res = await auth('post', `/api/inventory/restock/${items.CUP8._id}`)
      .send({ addedStock: 2 * 50 * 1, totalCost: 300, creditAccount: '111000' });
    expect(res.body.success).toBe(true);
    expect(await stockOf('CUP8') - before).toBe(100);

    // And two 500g bags of chocolate is a kilo.
    const choc = await stockOf('CHOC');
    await auth('post', `/api/inventory/restock/${items.CHOC._id}`)
      .send({ addedStock: 2 * 0.5 * 1000, totalCost: 800, creditAccount: '111000' });
    expect(await stockOf('CHOC') - choc).toBe(1000);
  });
});
