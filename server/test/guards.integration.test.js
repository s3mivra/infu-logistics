// Guard / error-path integration tests — exercise the validation, authorization,
// and edge branches in server.js that the happy-path suites don't reach, and
// lock in the two data-exposure fixes (order-PII projection + product COGS strip).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let app, stop, superToken, cashierToken;

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'fb', jwtSecret: 'guards-test-secret-0123456789' }));
  await makeUser({ name: 'GuardBoss', role: 'superadmin', password: 'pw' });
  await makeUser({ name: 'GuardCashier', role: 'cashier', password: 'pw' });
  superToken = await loginStaff(app, 'GuardBoss', 'pw');
  cashierToken = await loginStaff(app, 'GuardCashier', 'pw');
}, 120000);

afterAll(async () => { await stop(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });

describe('order creation — validation guards', () => {
  it('rejects an empty cart', async () => {
    const res = await request(app).post('/api/orders').set(auth(superToken)).send({ items: [], table: 'T1' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
  it('rejects a non-positive quantity', async () => {
    const res = await request(app).post('/api/orders').set(auth(superToken))
      .send({ items: [{ name: 'X', price: 10, quantity: 0 }], table: 'T1' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
  it('rejects a negative price', async () => {
    const res = await request(app).post('/api/orders').set(auth(superToken))
      .send({ items: [{ name: 'X', price: -5, quantity: 1 }], table: 'T1' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
  it('rejects an unauthenticated order with no QR session', async () => {
    const res = await request(app).post('/api/orders').send({ items: [{ name: 'X', price: 10, quantity: 1 }] });
    expect(res.status).toBe(401);
  });
});

describe('authorization guards', () => {
  it('void is superadmin-only — cashier gets 403', async () => {
    const res = await request(app).post('/api/orders/000000000000000000000000/void').set(auth(cashierToken)).send({});
    expect(res.status).toBe(403);
  });
  it('finance routes are superadmin-only — cashier gets 403', async () => {
    const res = await request(app).get('/api/journal').set(auth(cashierToken));
    expect(res.status).toBe(403);
  });
  it('user creation is superadmin-only — cashier gets 403', async () => {
    const res = await request(app).post('/api/users').set(auth(cashierToken)).send({ name: 'Nope', password: 'secret1' });
    expect(res.status).toBe(403);
  });
});

describe('validation (Zod 422) guards', () => {
  it('login with missing fields → 422', async () => {
    const res = await request(app).post('/api/users/login').send({ name: 'GuardBoss' });
    expect(res.status).toBe(422);
  });
  it('create user with too-short password → 422', async () => {
    const res = await request(app).post('/api/users').set(auth(superToken)).send({ name: 'Tiny', password: '123' });
    expect(res.status).toBe(422);
  });
  it('login with wrong password → 401', async () => {
    const res = await request(app).post('/api/users/login').send({ name: 'GuardBoss', password: 'wrong' });
    expect(res.status).toBe(401);
  });
});

describe('refresh/logout guards', () => {
  it('refresh with no cookie → 401', async () => {
    const res = await request(app).post('/api/auth/refresh').send({});
    expect(res.status).toBe(401);
  });
});

describe('GET /api/orders/:id — IDOR/PII projection (fix verification)', () => {
  let orderId;
  beforeAll(async () => {
    const Order = mongoose.model('Order');
    const o = await Order.create({
      orderNumber: 'ORD-2026-A9001', status: 'Preparing', table: 'T9',
      customerName: 'Jane', customerPhone: '09171234567', deliveryAddress: '123 Secret St',
      total: 250, items: [{ name: 'Latte', quantity: 1, itemStatus: 'Received' }],
    });
    orderId = o._id.toString();
  });
  it('invalid ObjectId → 404', async () => {
    const res = await request(app).get('/api/orders/not-an-id');
    expect(res.status).toBe(404);
  });
  it('anonymous caller gets status fields but NOT phone/address', async () => {
    const res = await request(app).get(`/api/orders/${orderId}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Preparing');
    expect(res.body.customerPhone).toBeUndefined();
    expect(res.body.deliveryAddress).toBeUndefined();
  });
  it('staff caller gets the full document incl. PII', async () => {
    const res = await request(app).get(`/api/orders/${orderId}`).set(auth(superToken));
    expect(res.status).toBe(200);
    expect(res.body.customerPhone).toBe('09171234567');
  });
});

describe('GET /api/products — COGS/recipe strip (fix verification)', () => {
  beforeAll(async () => {
    const Product = mongoose.model('Product');
    await Product.create({
      name: 'Secret Recipe Latte', basePrice: 120, businessType: 'fb',
      baseRecipe: [{ invId: 'i1', name: 'Beans', qty: 18, cost: 7 }],
      costOverride: 42,
      sizes: [{ name: 'L', price: 150, recipe: [{ invId: 'i1', name: 'Beans', qty: 24, cost: 9 }] }],
    });
  });
  it('anonymous response omits baseRecipe / costOverride / size recipe', async () => {
    const res = await request(app).get('/api/products');
    const p = res.body.products.find(x => x.name === 'Secret Recipe Latte');
    expect(p).toBeTruthy();
    expect(p.baseRecipe).toBeUndefined();
    expect(p.costOverride).toBeUndefined();
    expect((p.sizes[0] || {}).recipe).toBeUndefined();
    expect(p.basePrice).toBe(120); // customer-facing fields preserved
  });
  it('admin response keeps recipe/cost for management', async () => {
    const res = await request(app).get('/api/products').set(auth(superToken));
    const p = res.body.products.find(x => x.name === 'Secret Recipe Latte');
    expect(Array.isArray(p.baseRecipe)).toBe(true);
    expect(p.costOverride).toBe(42);
  });
});
