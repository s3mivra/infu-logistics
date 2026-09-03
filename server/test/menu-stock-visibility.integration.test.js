// A recipe-built product must report the SAME availability to a customer as it
// does to staff. GET /api/products strips baseRecipe from customer-facing
// responses (recipes and costs are internal), and the stockAvailable check used
// to read that field AFTER it had been deleted - so to a customer every FB drink
// looked like a 1:1 stocked good with no matching inventory item, and the whole
// menu showed "Not available" no matter how much stock was on hand.
//
// Staff saw the correct figure because their response keeps the recipe, which is
// why the admin list and the QR menu disagreed.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'StockSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'StockSuper');
}, 120000);

afterAll(async () => { await ctx.stop(); });

const Product = () => mongoose.model('Product');
const Inventory = () => mongoose.model('Inventory');

beforeEach(async () => {
  await Product().deleteMany({});
  await Inventory().deleteMany({});
});

// Anonymous = the QR menu. Staff = the Products tab.
const asCustomer = () => request(app).get('/api/products');
const asStaff = () => request(app).get('/api/products').set('Authorization', `Bearer ${tok}`);
const find = (res, name) => res.body.products.find(p => p.name === name);

async function espressoWithBeans({ stockQty, perShot = 18 }) {
  const beans = await Inventory().create({ itemCode: 'RM-BEAN', itemName: 'Coffee Beans', unit: 'g', stockQty, unitCost: 1 });
  await Product().create({
    productCode: 'BEV-0001', name: 'Espresso', category: 'Black & White', basePrice: 99,
    baseRecipe: [{ invId: String(beans._id), name: 'Coffee Beans', qty: perShot, cost: 1, unit: 'g' }],
  });
  return beans;
}

describe('customer and staff must agree on availability', () => {
  it('shows a well-stocked recipe drink as AVAILABLE to a customer', async () => {
    await espressoWithBeans({ stockQty: 500 }); // ~27 shots

    const customer = find(await asCustomer(), 'Espresso');
    expect(customer.stockAvailable).toBe(true);
  });

  it('agrees with staff on the same product', async () => {
    await espressoWithBeans({ stockQty: 500 });

    expect(find(await asCustomer(), 'Espresso').stockAvailable)
      .toBe(find(await asStaff(), 'Espresso').stockAvailable);
  });

  it('agrees when the ingredient IS short', async () => {
    await espressoWithBeans({ stockQty: 5, perShot: 18 }); // not even one shot

    const customer = find(await asCustomer(), 'Espresso');
    const staff = find(await asStaff(), 'Espresso');
    expect(customer.stockAvailable).toBe(false);
    expect(staff.stockAvailable).toBe(false);
    expect(customer.stockAvailable).toBe(staff.stockAvailable);
  });

  it('agrees when the ingredient is completely out', async () => {
    await espressoWithBeans({ stockQty: 0 });
    expect(find(await asCustomer(), 'Espresso').stockAvailable).toBe(false);
    expect(find(await asStaff(), 'Espresso').stockAvailable).toBe(false);
  });
});

describe('recipe data still never reaches a customer', () => {
  it('strips the recipe and cost fields from the customer response', async () => {
    await espressoWithBeans({ stockQty: 500 });
    const customer = find(await asCustomer(), 'Espresso');

    // The whole point of the strip: ingredients, costs and margins stay internal.
    expect(customer.baseRecipe).toBeUndefined();
    expect(customer.costOverride).toBeUndefined();
    expect(customer.clientDiscounts).toBeUndefined();
    // And the private copy used for the stock check must not leak either.
    expect(customer.__recipeForStock).toBeUndefined();
    expect(JSON.stringify(customer)).not.toMatch(/Coffee Beans/);
  });

  it('still gives staff the recipe they need for the edit form', async () => {
    await espressoWithBeans({ stockQty: 500 });
    const staff = find(await asStaff(), 'Espresso');
    expect(staff.baseRecipe).toHaveLength(1);
    expect(staff.baseRecipe[0].name).toBe('Coffee Beans');
    expect(staff.__recipeForStock).toBeUndefined();
  });

  it('strips size and add-on recipes from the customer response too', async () => {
    const beans = await Inventory().create({ itemCode: 'RM-BEAN', itemName: 'Coffee Beans', unit: 'g', stockQty: 500, unitCost: 1 });
    await Product().create({
      productCode: 'BEV-0002', name: 'Long Black', category: 'Black & White', basePrice: 100,
      baseRecipe: [{ invId: String(beans._id), name: 'Coffee Beans', qty: 18, cost: 1, unit: 'g' }],
      sizes: [{ sizeCode: 'L', name: 'Large', price: 120, recipe: [{ invId: String(beans._id), name: 'Coffee Beans', qty: 24, cost: 1, unit: 'g' }] }],
      addOns: [{ name: 'Extra Shot', price: 30, recipe: [{ invId: String(beans._id), name: 'Coffee Beans', qty: 18, cost: 1, unit: 'g' }] }],
    });

    const customer = find(await asCustomer(), 'Long Black');
    expect(customer.stockAvailable).toBe(true);          // still correctly available
    expect(customer.sizes[0].recipe).toBeUndefined();
    expect(customer.sizes[0].price).toBe(120);            // customer-facing data kept
    expect(customer.addOns[0].recipe).toBeUndefined();
    expect(customer.addOns[0].price).toBe(30);
  });
});

describe('why a product is unavailable', () => {
  it('names the ingredient whose stock record has gone', async () => {
    await Product().create({
      productCode: 'BEV-0003', name: 'Ghost Latte', category: 'Coffee', basePrice: 120,
      baseRecipe: [{ invId: String(new mongoose.Types.ObjectId()), name: 'Vanished Syrup', qty: 10, cost: 1, unit: 'ml' }],
    });
    const p = find(await asStaff(), 'Ghost Latte');
    expect(p.stockAvailable).toBe(false);
    expect(p.stockReason).toMatch(/Vanished Syrup/);
  });

  it('explains a product with no linked recipe at all', async () => {
    await Product().create({ productCode: 'BEV-0004', name: 'Unlinked Drink', category: 'Coffee', basePrice: 90, baseRecipe: [] });
    const p = find(await asStaff(), 'Unlinked Drink');
    expect(p.stockAvailable).toBe(false);
    expect(p.stockReason).toMatch(/No recipe ingredients are linked/i);
  });

  it('says nothing when the product is fine', async () => {
    await espressoWithBeans({ stockQty: 500 });
    expect(find(await asStaff(), 'Espresso').stockReason).toBe('');
  });
});
