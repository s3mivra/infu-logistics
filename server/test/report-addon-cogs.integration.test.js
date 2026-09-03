// Profit reports must cost an add-on, not just bill for it.
//
// reportLinesForItem counted add-on REVENUE into the line but computed COGS
// from the product's base/size recipe alone. An "Extra Shot" therefore added
// P30 of revenue at P0 of cost, inflating margin on exactly the items these
// reports exist to judge. The real ledger was never wrong - order completion
// always deducted add-on stock and posted its cost to 510000 - so the books and
// the analytics disagreed.
//
// Add-ons resolve two ways, matching the deduction path: a product add-on, or a
// modifier-group option stored as "Group name: Option name".
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'CogsSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'CogsSuper');
}, 120000);

afterAll(async () => { await ctx.stop(); });

const M = (n) => mongoose.model(n);

beforeEach(async () => {
  for (const n of ['Product', 'Inventory', 'Order', 'ModifierGroup']) await M(n).deleteMany({});
});

// Beans at P1/g keeps the arithmetic obvious: 18g = P18.
async function seedBeans() {
  return M('Inventory').create({ itemCode: 'RM-BEAN', itemName: 'Coffee Beans', unit: 'g', stockQty: 100000, unitCost: 1 });
}

async function completedOrder(items, total) {
  return M('Order').create({
    orderNumber: `RPT-${Math.random().toString(36).slice(2, 8)}`,
    status: 'Completed', paymentMethod: 'Cash', total, subtotal: total, items,
  });
}

const range = () => {
  const d = new Date();
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0, 10);
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).toISOString().slice(0, 10);
  return `start=${start}&end=${end}`;
};

// The report aggregates per CATEGORY, not per product. Each test seeds a single
// product in "Coffee" and clears orders between runs, so the category row is
// exactly that one product's line.
const lineFor = (body) => {
  const c = (body.categories || []).find(x => x.category === 'Coffee');
  return c && { revenue: c.revenue, cogs: c.estimatedCOGS };
};

describe('add-on cost reaches the profit report', () => {
  it('counts the cost of a product add-on, not only its price', async () => {
    const beans = await seedBeans();
    await M('Product').create({
      productCode: 'BEV-0001', name: 'Espresso', category: 'Coffee', basePrice: 100,
      baseRecipe: [{ invId: String(beans._id), name: 'Coffee Beans', qty: 18, cost: 1, unit: 'g' }],
      addOns: [{ name: 'Extra Shot', price: 30, recipe: [{ invId: String(beans._id), name: 'Coffee Beans', qty: 18, cost: 1, unit: 'g' }] }],
    });
    await completedOrder([{
      productId: null, name: 'Espresso', quantity: 1, price: 100,
      selectedAddOns: [{ name: 'Extra Shot', price: 30 }],
    }], 130);

    const res = await auth('get', `/api/reports/profit-by-category?${range()}`);
    expect(res.status).toBe(200);
    const line = lineFor(res.body);

    expect(line.revenue).toBeCloseTo(130, 2);   // drink + add-on
    expect(line.cogs).toBeCloseTo(36, 2);       // 18g base + 18g add-on
  });

  it('costs a modifier-group option the same way', async () => {
    const beans = await seedBeans();
    const grp = await M('ModifierGroup').create({
      name: 'Shots', isRequired: false, minSelect: 0, maxSelect: 2,
      options: [{ name: 'Double', price: 25, recipe: [{ invId: String(beans._id), name: 'Coffee Beans', qty: 18, unit: 'g' }] }],
    });
    await M('Product').create({
      productCode: 'BEV-0002', name: 'Latte', category: 'Coffee', basePrice: 120,
      baseRecipe: [{ invId: String(beans._id), name: 'Coffee Beans', qty: 18, cost: 1, unit: 'g' }],
      modifierGroups: [grp._id],
    });
    await completedOrder([{
      name: 'Latte', quantity: 1, price: 120,
      selectedAddOns: [{ name: 'Shots: Double', price: 25 }], // "Group: Option"
    }], 145);

    const line = lineFor((await auth('get', `/api/reports/profit-by-category?${range()}`)).body);
    expect(line.revenue).toBeCloseTo(145, 2);
    expect(line.cogs).toBeCloseTo(36, 2);
  });

  it('scales add-on cost with the line quantity', async () => {
    const beans = await seedBeans();
    await M('Product').create({
      productCode: 'BEV-0003', name: 'Americano', category: 'Coffee', basePrice: 100,
      baseRecipe: [{ invId: String(beans._id), name: 'Coffee Beans', qty: 10, cost: 1, unit: 'g' }],
      addOns: [{ name: 'Extra Shot', price: 30, recipe: [{ invId: String(beans._id), name: 'Coffee Beans', qty: 20, cost: 1, unit: 'g' }] }],
    });
    await completedOrder([{
      name: 'Americano', quantity: 3, price: 100,
      selectedAddOns: [{ name: 'Extra Shot', price: 30 }],
    }], 390);

    const line = lineFor((await auth('get', `/api/reports/profit-by-category?${range()}`)).body);
    expect(line.revenue).toBeCloseTo(390, 2);      // (100 + 30) x 3
    expect(line.cogs).toBeCloseTo(90, 2);          // (10g + 20g) x 3
  });

  it('leaves a plain sale with no add-ons unchanged', async () => {
    const beans = await seedBeans();
    await M('Product').create({
      productCode: 'BEV-0004', name: 'Black Coffee', category: 'Coffee', basePrice: 80,
      baseRecipe: [{ invId: String(beans._id), name: 'Coffee Beans', qty: 15, cost: 1, unit: 'g' }],
    });
    await completedOrder([{ name: 'Black Coffee', quantity: 2, price: 80, selectedAddOns: [] }], 160);

    const line = lineFor((await auth('get', `/api/reports/profit-by-category?${range()}`)).body);
    expect(line.revenue).toBeCloseTo(160, 2);
    expect(line.cogs).toBeCloseTo(30, 2);
  });

  it('charges nothing extra for an add-on that has no recipe', async () => {
    // A purely-priced add-on (a surcharge, not an ingredient) must not invent cost.
    const beans = await seedBeans();
    await M('Product').create({
      productCode: 'BEV-0005', name: 'Takeaway Brew', category: 'Coffee', basePrice: 90,
      baseRecipe: [{ invId: String(beans._id), name: 'Coffee Beans', qty: 12, cost: 1, unit: 'g' }],
      addOns: [{ name: 'Takeaway Fee', price: 5, recipe: [] }],
    });
    await completedOrder([{
      name: 'Takeaway Brew', quantity: 1, price: 90,
      selectedAddOns: [{ name: 'Takeaway Fee', price: 5 }],
    }], 95);

    const line = lineFor((await auth('get', `/api/reports/profit-by-category?${range()}`)).body);
    expect(line.revenue).toBeCloseTo(95, 2);
    expect(line.cogs).toBeCloseTo(12, 2);   // base only
  });
});
