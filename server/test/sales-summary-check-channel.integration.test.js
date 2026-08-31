// Sales Summary's channel columns (Cash / E-Wallet / Bank / Delivery). A check
// tendered at sale used to fall into the default 'ewallet' bucket - it isn't
// Cash, Bank Transfer, or a delivery partner, so paymentChannel() silently
// caught it in the catch-all meant for GCash/Maya/etc. But a collected check
// is handled the same way cash is (goes in the drawer, not a wallet balance),
// so it belongs in the Cash column for this report even though it still
// books to its own COA account (115000 Checks on Hand) in the ledger.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, superTok, prod;
const auth = (m, p, t) => request(app)[m](p).set('Authorization', `Bearer ${t}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'sscSuper', role: 'superadmin' });
  superTok = await loginStaff(app, 'sscSuper');
  await mongoose.model('Category').create({ name: 'SscCat', department: 'Logistics' });
  prod = await mongoose.model('Product').create({ name: 'Widget', category: 'SscCat', basePrice: 300 });
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('Sales Summary channel bucketing', () => {
  it('a check-tendered sale lands in the Cash column, not E-Wallet', async () => {
    const order = await auth('post', '/api/orders', superTok).send({
      items: [{ productId: String(prod._id), name: 'Widget', price: 300, quantity: 1 }],
      table: 'Takeout', paymentMethod: 'Check', paymentReference: 'CHK-9001',
    });
    expect(order.status).toBe(200);
    await auth('put', `/api/orders/${order.body.order._id}`, superTok).send({ status: 'Completed' });

    const res = await auth('get', '/api/reports/sales-summary', superTok);
    expect(res.status).toBe(200);
    const row = res.body.rows.find(r => r.orderNumber === order.body.order.orderNumber);
    expect(row).toBeTruthy();
    expect(row.cash).toBe(300);
    expect(row.ewallet).toBe(0);
  });

  it('does not disturb Cash itself or the e-wallet catch-all', async () => {
    const cashOrder = await auth('post', '/api/orders', superTok).send({
      items: [{ productId: String(prod._id), name: 'Widget', price: 300, quantity: 1 }],
      table: 'Takeout', paymentMethod: 'Cash',
    });
    await auth('put', `/api/orders/${cashOrder.body.order._id}`, superTok).send({ status: 'Completed' });

    const gcashOrder = await auth('post', '/api/orders', superTok).send({
      items: [{ productId: String(prod._id), name: 'Widget', price: 300, quantity: 1 }],
      table: 'Takeout', paymentMethod: 'GCash',
    });
    await auth('put', `/api/orders/${gcashOrder.body.order._id}`, superTok).send({ status: 'Completed' });

    const res = await auth('get', '/api/reports/sales-summary', superTok);
    const cashRow = res.body.rows.find(r => r.orderNumber === cashOrder.body.order.orderNumber);
    const gcashRow = res.body.rows.find(r => r.orderNumber === gcashOrder.body.order.orderNumber);
    expect(cashRow.cash).toBe(300);
    expect(gcashRow.ewallet).toBe(300);
    expect(gcashRow.cash).toBe(0);
  });
});
