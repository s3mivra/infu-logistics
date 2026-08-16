// Seller commission tracking - GET /api/reports/commissions and the
// commissionRate field on User. Drives the real Express app over HTTP against
// an in-memory replica set, same harness as critical-paths.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, superTok, cashierTok, prod;
const auth = (method, path, token) => request(app)[method](path).set('Authorization', `Bearer ${token}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'commSuper', role: 'superadmin' });
  await makeUser({ name: 'commCashier', role: 'cashier' });
  superTok = await loginStaff(app, 'commSuper');
  cashierTok = await loginStaff(app, 'commCashier');

  const Category = mongoose.model('Category');
  const Product = mongoose.model('Product');
  await Category.create({ name: 'CommCat', department: 'Kitchen' });
  prod = await Product.create({ name: 'Comm Widget', category: 'CommCat', basePrice: 100, baseRecipe: [] });
}, 120000);

afterAll(async () => { await ctx.stop(); });

it('rejects an out-of-range commissionRate', async () => {
  const list = await auth('get', '/api/users', superTok);
  const user = list.body.users.find((u) => u.name === 'commCashier');
  const res = await auth('patch', `/api/users/${user._id}`, superTok).send({ commissionRate: 150 });
  expect(res.status).toBe(400);
});

describe('commission report', () => {
  let userId;

  it('sets a 10% commission rate on the cashier', async () => {
    const list = await auth('get', '/api/users', superTok);
    userId = list.body.users.find((u) => u.name === 'commCashier')._id;
    const res = await auth('patch', `/api/users/${userId}`, superTok).send({ commissionRate: 10 });
    expect(res.status).toBe(200);
    expect(res.body.user.commissionRate).toBe(10);
  });

  it('is gated behind reports.view - the cashier role default permissions don\'t include it, matching every other report endpoint', async () => {
    const res = await auth('get', '/api/reports/commissions', cashierTok);
    expect(res.status).toBe(403);
  });

  it('computes commissionEarned from completed sales × rate, excluding complimentary orders', async () => {
    // A normal ₱200 sale (2 × 100) placed and completed by commCashier.
    const orderBody = {
      items: [{ productId: String(prod._id), name: 'Comm Widget', price: 100, quantity: 2 }],
      table: 'Takeout', paymentMethod: 'Cash',
    };
    const created = await auth('post', '/api/orders', cashierTok).send(orderBody);
    expect(created.status).toBe(200);
    await auth('put', `/api/orders/${created.body.order._id}`, cashierTok).send({ status: 'Completed' });

    // A complimentary order - must NOT count toward sales/commission.
    const compCreated = await auth('post', '/api/orders', cashierTok).send({ ...orderBody, isComplimentary: true });
    expect(compCreated.status).toBe(200);

    const res = await auth('get', '/api/reports/commissions', superTok);
    expect(res.status).toBe(200);
    const seller = res.body.sellers.find((s) => s.name === 'commCashier');
    expect(seller).toBeTruthy();
    expect(seller.salesTotal).toBeCloseTo(200, 2);
    expect(seller.commissionRate).toBe(10);
    expect(seller.commissionEarned).toBeCloseTo(20, 2); // 200 * 10%
    expect(res.body.totalCommission).toBeCloseTo(seller.commissionEarned, 2);
  });

  it('does not attribute a commission to the unattributed "System" cashier', async () => {
    const res = await auth('get', '/api/reports/commissions', superTok);
    expect(res.body.sellers.some((s) => s.name === 'System')).toBe(false);
  });
});
