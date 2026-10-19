// Routes that change the menu, prices, stock or order flow used to require
// only a staff login. An audit, using the lowest built-in role, created
// products, deleted categories, made a 50% discount preset and recorded
// spoilage (a ledger posting). The permissions for those actions existed
// (products.manage, inventory.manage, ...) but nothing enforced them.
//
// Each row: what a plain `staff` user (pos.use, orders.view, inventory.view,
// products.view) must be refused, and which permission lets someone through.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, staffTok;
const holders = {};
const Z = '000000000000000000000000';

// method, path, permission that grants it
const GATED = [
  ['post', '/api/categories', 'products.manage'],
  ['put', `/api/categories/${Z}`, 'products.manage'],
  ['delete', `/api/categories/${Z}`, 'products.manage'],
  ['post', '/api/products', 'products.manage'],
  ['post', '/api/products/import-menu', 'products.manage'],
  ['put', `/api/products/${Z}`, 'products.manage'],
  ['delete', `/api/products/${Z}`, 'products.manage'],
  ['post', '/api/discounts', 'products.manage'],
  ['delete', `/api/discounts/${Z}`, 'products.manage'],
  ['post', '/api/inventory', 'inventory.manage'],
  ['post', '/api/inventory/eod/reopen', 'inventory.manage'],
  ['post', `/api/inventory/restock/${Z}`, 'inventory.manage'],
  ['patch', `/api/inventory/${Z}/expiry`, 'inventory.manage'],
  ['post', '/api/stock-transfers', 'inventory.manage'],
  ['post', `/api/stock-transfers/${Z}/release`, 'inventory.manage'],
  ['post', '/api/production-orders', 'inventory.manage'],
  ['post', `/api/orders/${Z}/partial-fulfill`, 'orders.manage'],
  ['post', `/api/orders/${Z}/drop-remaining`, 'orders.manage'],
  ['patch', `/api/orders/${Z}/dispatch`, 'orders.manage'],
  ['post', '/api/hub/transfers/send', 'inventory.manage'],
  ['post', '/api/hub/transfer-requests', 'inventory.manage'],
];
// Counts, waste, comps and bank deposits are deliberately open to the staff
// role (inventory.count / inventory.waste / orders.comp, and pos.use for a
// deposit), so they are not in this list.

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'Crew', role: 'staff' });
  staffTok = await loginStaff(app, 'Crew');
  for (const perm of new Set(GATED.map(g => g[2]))) {
    const name = `Has_${perm.replace('.', '_')}`;
    await makeUser({ name, role: 'staff', permissions: ['pos.use', 'orders.view', 'inventory.view', 'products.view', perm] });
    holders[perm] = await loginStaff(app, name);
  }
}, 120000);

afterAll(async () => { await ctx?.stop?.(); });

describe('a plain staff login is refused', () => {
  for (const [m, path, perm] of GATED) {
    it(`${m.toUpperCase()} ${path} needs ${perm}`, async () => {
      const r = await request(app)[m](path).set('Authorization', `Bearer ${staffTok}`).send({ name: 'Probe', percentage: 50 });
      expect(r.status).toBe(403);
    });
  }

  it('and nothing it tried was written', async () => {
    expect(await mongoose.model('Discount').countDocuments({ name: /probe/i })).toBe(0);
    expect(await mongoose.model('Category').countDocuments({ name: /probe/i })).toBe(0);
    expect(await mongoose.model('Product').countDocuments({ name: /probe/i })).toBe(0);
  });
});

describe('holding the permission gets through the gate', () => {
  for (const [m, path, perm] of GATED) {
    it(`${m.toUpperCase()} ${path} with ${perm}`, async () => {
      const r = await request(app)[m](path).set('Authorization', `Bearer ${holders[perm]}`).send({});
      // Past the permission gate: whatever it says next (404 for the dummy
      // id, 400 for the empty body) it is not a permission refusal.
      expect(r.status).not.toBe(403);
    });
  }
});

describe('order routes a cashier genuinely needs', () => {
  it('a plain staff member can still park an order and settle a tender', async () => {
    const prod = await mongoose.model('Product').create({ name: 'Tea', category: 'X', basePrice: 50 });
    const o = await request(app).post('/api/orders').set('Authorization', `Bearer ${staffTok}`)
      .send({ table: 'Takeout', paymentMethod: 'Cash', items: [{ productId: String(prod._id), name: 'Tea', price: 50, quantity: 1 }] });
    expect(o.status, JSON.stringify(o.body)).toBe(200);
    const put = await request(app).put(`/api/orders/${o.body.order._id}`).set('Authorization', `Bearer ${staffTok}`)
      .send({ status: 'Preparing', amountTendered: 50 });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
  });
});
