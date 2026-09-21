// An extra that takes something from stock.
//
// An extra shot is coffee; boba is boba. An add-on has always had a place for
// a recipe, but Menu Setup had no way to fill it in, and the till read only
// the copy a product keeps when an add-on is attached - a copy created empty.
// So every extra shot sold took no coffee and cost nothing. The till now uses
// the add-on's own recipe when the product carries none, and every path that
// reverses a sale uses the same rule, so a void returns what the sale took.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const M = (n) => mongoose.model(n);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'CafeSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'CafeSuper');
  await M('Category').create({ name: 'Coffee' });
}, 120000);

afterAll(async () => { await ctx.stop(); });

let beans, water, latte;
beforeEach(async () => {
  for (const n of ['AddOn', 'Product', 'Inventory', 'Order', 'StockCard']) await M(n).deleteMany({});
  beans = await M('Inventory').create({ itemCode: 'BEAN', itemName: 'ESPRESSO BEANS', unit: 'g', stockQty: 1000, unitCost: 1.2 });
  // A stock item that happens to share a name with a non-stock line. It must
  // never be drained by one.
  water = await M('Inventory').create({ itemCode: 'WTR', itemName: 'HOT WATER', unit: 'ml', stockQty: 5000, unitCost: 0.01 });
  await M('AddOn').create({
    name: 'Extra Shot', price: 30, category: 'Extras',
    recipe: [
      { invId: String(beans._id), name: 'ESPRESSO BEANS', qty: 18, cost: 1.2, unit: 'g', packBase: 1 },
      { name: 'HOT WATER', qty: 30, cost: 0, unit: 'ml', packBase: 1, nonStock: true },
    ],
  });
  // Attached the way Menu Setup attaches one: the product's copy is empty.
  latte = await M('Product').create({
    name: 'Latte', category: 'Coffee', basePrice: 130,
    baseRecipe: [{ invId: String(beans._id), name: 'ESPRESSO BEANS', qty: 20, cost: 1.2, unit: 'g', packBase: 1 }],
    addOns: [{ name: 'Extra Shot', price: 30, recipe: [] }],
  });
});

const sell = async (withShot = true) => {
  const placed = await auth('post', '/api/orders').send({
    table: 'Dine-In', paymentMethod: 'Cash', customerName: 'Walk-in',
    items: [{ productId: String(latte._id), name: 'Latte', price: 130, quantity: 1,
      selectedAddOns: withShot ? [{ name: 'Extra Shot', price: 30 }] : [] }],
  });
  expect(placed.body.success).toBe(true);
  await auth('put', `/api/orders/${placed.body.order._id}`).send({ status: 'Completed' });
  return placed.body.order;
};
const stock = async (doc) => (await M('Inventory').findById(doc._id).lean()).stockQty;

describe('selling an extra', () => {
  it('takes the add-on\'s own recipe when the product carries none', async () => {
    await sell();
    // 20 g for the latte, 18 g for the extra shot.
    expect(await stock(beans)).toBe(1000 - 20 - 18);
  });

  it('takes nothing extra when the add-on is not chosen', async () => {
    await sell(false);
    expect(await stock(beans)).toBe(1000 - 20);
  });

  it('never takes a line that is not stock, whatever it is called', async () => {
    await sell();
    expect(await stock(water)).toBe(5000);
  });

  it('lets a product keep its own amount for an extra', async () => {
    // A double-shot drink whose extra is a bigger pour than the house one.
    await M('Product').updateOne({ _id: latte._id }, { $set: { addOns: [{ name: 'Extra Shot', price: 30,
      recipe: [{ invId: String(beans._id), name: 'ESPRESSO BEANS', qty: 25, cost: 1.2, unit: 'g', packBase: 1 }] }] } });
    await sell();
    expect(await stock(beans)).toBe(1000 - 20 - 25);
  });
});

describe('reversing a sale with an extra in it', () => {
  it('puts back what the extra took', async () => {
    const order = await sell();
    expect(await stock(beans)).toBe(962);
    const res = await auth('post', `/api/orders/${order._id}/void`).send({ reason: 'Restock' });
    expect(res.body.success).toBe(true);
    // All of it - the latte's 20 g AND the extra shot's 18 g.
    expect(await stock(beans)).toBe(1000);
  });
});

describe('who can see an extra\'s recipe', () => {
  it('is staff only: the public menu gets names and prices', async () => {
    const pub = await request(app).get('/api/addons');
    expect(pub.body.addons[0].name).toBe('Extra Shot');
    expect(pub.body.addons[0].price).toBe(30);
    expect(pub.body.addons[0].recipe).toBeUndefined();

    const staff = await auth('get', '/api/addons');
    expect(staff.body.addons[0].recipe).toHaveLength(2);
  });
});

// The tests above seed add-ons through the model. Menu Setup goes through the
// route, which validates - and its schema was the one part that had not been
// taught about recipes: it required an inventory id on every line, so an
// add-on with a non-stock line was refused outright, and `packBase` was
// stripped from the lines that did save.
describe('saving an extra from Menu Setup', () => {
  it('keeps a stock line and a non-stock line, with their pack sizes', async () => {
    const body = {
      name: 'Boba', price: 20, category: 'Extras',
      recipe: [
        { invId: String(beans._id), name: 'ESPRESSO BEANS', qty: 12, cost: 1.2, unit: 'g', packBase: 1000 },
        { name: 'FILTERED WATER', qty: 40, cost: 0, unit: 'ml', packBase: 1, nonStock: true },
      ],
    };
    const res = await auth('post', '/api/addons').send(body);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const saved = await M('AddOn').findOne({ name: 'Boba' }).lean();
    expect(saved.recipe).toHaveLength(2);
    expect(saved.recipe[0]).toMatchObject({ qty: 12, unit: 'g', packBase: 1000 });
    expect(saved.recipe[1]).toMatchObject({ name: 'FILTERED WATER', qty: 40, nonStock: true });
    expect(saved.recipe[1].invId == null).toBe(true);
  });

  it('can take the recipe away again', async () => {
    const created = await auth('post', '/api/addons').send({
      name: 'Syrup', price: 15,
      recipe: [{ invId: String(beans._id), name: 'ESPRESSO BEANS', qty: 5, unit: 'g' }],
    });
    const res = await auth('patch', `/api/addons/${created.body.addon._id}`)
      .send({ name: 'Syrup', price: 15, recipe: [] });
    expect(res.status).toBe(200);
    expect((await M('AddOn').findById(created.body.addon._id).lean()).recipe).toHaveLength(0);
  });
});
