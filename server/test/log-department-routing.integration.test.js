// A logistics business has no kitchen, and nothing may route to one.
//
// Three places decide an item's station - the category's own department, the
// per-business-type default on the schema, and the fallback in the order
// route - and each of them has to agree that a log deployment only has
// Logistics and Warehouse. Get any one wrong and the order is accepted, the
// ticket prints, and the item appears under neither filter, so nobody picks
// it.
//
// These tests pin the outcome rather than any one of those three, because the
// outcome is the thing that matters: on a log deployment, no item is ever
// stamped Kitchen.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const M = (n) => mongoose.model(n);

beforeAll(async () => {
  // log, deliberately: this is the deployment with no kitchen.
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'LogSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'LogSuper');
}, 120000);

afterAll(async () => { await ctx.stop(); });

let product;
beforeEach(async () => {
  for (const n of ['Order', 'Product', 'Category', 'JournalEntry']) await M(n).deleteMany({});
});

// A category left as it arrives: nobody has chosen a department for it.
const makeProduct = async (categoryName, department) => {
  await M('Category').create({ name: categoryName, ...(department ? { department } : {}) });
  return M('Product').create({
    productCode: 'P-1', name: 'Pallet of Beans', category: categoryName, basePrice: 500,
  });
};

const placeOrder = () => auth('post', '/api/orders').send({
  table: 'Pickup', paymentMethod: 'Cash',
  items: [{ productId: String(product._id), name: product.name, price: 500, quantity: 1 }],
});

describe('routing an order on a logistics deployment', () => {
  it('sends an unconfigured category to Logistics, not to a kitchen', async () => {
    product = await makeProduct('Uncategorised');
    const res = await placeOrder();
    expect(res.status).toBe(200);

    const order = await M('Order').findById(res.body.order._id).lean();
    // The failure this catches: an item stamped for a station that does not
    // exist here, which then appears under no filter at all.
    expect(order.items[0].department).toBe('Logistics');
    expect(order.items[0].department).not.toBe('Kitchen');
  }, 30000);

  it('still honours a department someone did choose', async () => {
    product = await makeProduct('Bulk Storage', 'Warehouse');
    const res = await placeOrder();
    const order = await M('Order').findById(res.body.order._id).lean();
    expect(order.items[0].department).toBe('Warehouse');
  }, 30000);

  it('routes to a station this business actually has', async () => {
    product = await makeProduct('Uncategorised');
    const res = await placeOrder();
    const order = await M('Order').findById(res.body.order._id).lean();
    // Logistics/Warehouse are the only two stations on a log deployment, and
    // the order filter offers exactly those.
    expect(['Logistics', 'Warehouse']).toContain(order.items[0].department);
  }, 30000);
});
