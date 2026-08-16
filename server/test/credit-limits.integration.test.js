// Credit limit enforcement + A/R ageing, end to end.
// The unit tests in lib/credit.test.js cover the rules; these cover the wiring:
// that the gate actually blocks an order, that it only counts on-account sales,
// and that a blocked order leaves nothing behind.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let app, stop, superToken, clientToken, clientId, productId;

const daysAgo = (n) => new Date(Date.now() - n * 86400000);
const auth = (t) => ({ Authorization: `Bearer ${t}` });

const setMode = (mode, globalLimit) => Promise.all([
  request(app).patch('/api/settings/creditLimitMode').set(auth(superToken)).send({ value: mode }),
  request(app).patch('/api/settings/globalCreditLimit').set(auth(superToken)).send({ value: globalLimit }),
]);

const setClientLimit = (limit) =>
  request(app).patch(`/api/client-accounts/${clientId}`).set(auth(superToken)).send({ creditLimit: limit });

// Places an order as the logged-in client. GCash = on account (non-cash).
const placeOrder = (total, method = 'GCash') =>
  request(app).post('/api/orders')
    .set({ Authorization: `Bearer ${clientToken}` })
    .send({ items: [{ productId, name: 'Credit Widget', price: total, quantity: 1 }], paymentMethod: method });

// Seeds an already-owed, unsettled receivable for the client.
const owe = async (amount, ageDays = 1) => {
  const Order = mongoose.model('Order');
  await Order.create({
    orderNumber: 80000 + Math.floor(Math.random() * 9999),
    customerName: 'Credit Client', clientAccountId: String(clientId),
    status: 'Completed', paymentMethod: 'GCash', total: amount,
    arSettled: false, createdAt: daysAgo(ageDays), businessType: 'log',
  });
};

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'log', jwtSecret: 'credit-test-secret-0123456789' }));
  await makeUser({ name: 'CreditBoss', role: 'superadmin', password: 'pw' });
  await mongoose.model('User').updateMany({}, { $set: { tenantId: null } });
  superToken = await loginStaff(app, 'CreditBoss', 'pw');

  const ClientAccount = mongoose.model('ClientAccount');
  const c = await ClientAccount.create({
    clientCode: 'CUS-1000-A0500', username: 'creditclient',
    password: await bcrypt.hash('pw1234', 4), name: 'Credit Client', paymentMethod: 'GCash',
  });
  clientId = String(c._id);
  const login = await request(app).post('/api/client-auth/login').send({ username: 'creditclient', password: 'pw1234' });
  clientToken = login.body.token;

  const prod = await request(app).post('/api/products').set(auth(superToken))
    .send({ name: 'Credit Widget', category: 'Dry Goods', basePrice: 100 });
  productId = prod.body.product._id;
}, 120000);

afterAll(async () => { await stop(); });

beforeEach(async () => {
  // Each test starts from a clean receivable ledger and no limits.
  // Both identity fields must be cleared - portal orders carry clientId, not
  // clientAccountId, and leaving those behind leaks debt into later tests.
  await mongoose.model('Order').deleteMany({
    $or: [{ clientAccountId: String(clientId) }, { clientId: String(clientId) }],
  });
  await setClientLimit('');
  await setMode('off', null);
});

describe('mode: off', () => {
  it('lets a client buy on account with no limit at all', async () => {
    await owe(50000);
    const res = await placeOrder(9999);
    expect(res.status).toBeLessThan(300);
  });
});

describe('mode: per_client', () => {
  it('blocks the order that would breach the client limit', async () => {
    await setMode('per_client', null);
    await setClientLimit(1000);
    await owe(800);
    const res = await placeOrder(300);          // 800 + 300 = 1100 > 1000
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/credit limit/i);
    expect(res.body.creditLimit.available).toBe(200);
  });

  it('allows an order that lands exactly on the limit', async () => {
    await setMode('per_client', null);
    await setClientLimit(1000);
    await owe(800);
    const res = await placeOrder(200);          // exactly 1000
    expect(res.status).toBeLessThan(300);
  });

  it('leaves no order behind when it blocks', async () => {
    await setMode('per_client', null);
    await setClientLimit(100);
    await owe(100);
    const before = await mongoose.model('Order').countDocuments({ clientAccountId: String(clientId) });
    await placeOrder(500);
    const after = await mongoose.model('Order').countDocuments({ clientAccountId: String(clientId) });
    expect(after).toBe(before);
  });

  it('ignores clients with no limit set', async () => {
    await setMode('per_client', null);
    await setClientLimit('');                   // cleared
    await owe(99999);
    expect((await placeOrder(5000)).status).toBeLessThan(300);
  });
});

describe('mode: global', () => {
  it('applies one limit to everyone and ignores the per-client value', async () => {
    await setMode('global', 500);
    await setClientLimit(99999);                // must be ignored
    await owe(400);
    expect((await placeOrder(200)).status).toBe(409);
  });
});

describe('mode: both', () => {
  it('uses the global default when the client has none', async () => {
    await setMode('both', 500);
    await setClientLimit('');
    await owe(400);
    expect((await placeOrder(200)).status).toBe(409);
  });

  it('lets the client-specific limit override the global one', async () => {
    await setMode('both', 500);
    await setClientLimit(5000);
    await owe(400);
    expect((await placeOrder(200)).status).toBeLessThan(300);
  });

  it('honours a client limit of ZERO as cash-only, not as unset', async () => {
    // The regression this protects: `clientLimit || globalLimit` would hand a
    // ₱500 limit to a client deliberately set to zero credit.
    await setMode('both', 500);
    await setClientLimit(0);
    expect((await placeOrder(1)).status).toBe(409);
  });
});

describe('what consumes credit', () => {
  it('does NOT gate cash orders - they settle immediately', async () => {
    await setMode('per_client', null);
    await setClientLimit(100);
    await owe(100);                             // already at the limit
    expect((await placeOrder(5000, 'Cash')).status).toBeLessThan(300);
  });

  it('does not count already-settled receivables toward the limit', async () => {
    await setMode('per_client', null);
    await setClientLimit(1000);
    const Order = mongoose.model('Order');
    await Order.create({
      orderNumber: 87001, customerName: 'Credit Client', clientAccountId: String(clientId),
      status: 'Completed', paymentMethod: 'GCash', total: 900,
      arSettled: true, createdAt: daysAgo(2), businessType: 'log',   // settled
    });
    expect((await placeOrder(900)).status).toBeLessThan(300);
  });
});

describe('debt is counted however the order was placed', () => {
  // Portal orders carry `clientId`; admin-on-behalf orders carry
  // `clientAccountId`. Counting only one of them lets a client run up unlimited
  // debt through the other route.
  it('counts debt from orders placed through the client portal', async () => {
    await setMode('per_client', null);
    await setClientLimit(1000);
    const Order = mongoose.model('Order');
    await Order.create({
      orderNumber: 88001, customerName: 'Credit Client',
      clientId: String(clientId), placedByClient: true,     // portal shape - no clientAccountId
      status: 'Completed', paymentMethod: 'GCash', total: 900,
      arSettled: false, createdAt: daysAgo(2), businessType: 'log',
    });
    // 900 owed + 200 new = 1100 > 1000 → must be blocked
    expect((await placeOrder(200)).status).toBe(409);
  });

  it('counts debt accumulated by a real portal order end-to-end', async () => {
    await setMode('per_client', null);
    await setClientLimit(1000);
    const first = await placeOrder(900);
    expect(first.status).toBeLessThan(300);
    // Mark it completed & unsettled, the state a real receivable reaches.
    await mongoose.model('Order').updateOne(
      { _id: first.body.order._id },
      { $set: { status: 'Completed', arSettled: false } }
    );
    expect((await placeOrder(200)).status).toBe(409);
  });
});

describe('exposure counts committed orders, not just completed ones', () => {
  // Orders sit at Pending/Preparing until fulfilled. If only 'Completed' counted,
  // a client could place order after order and defeat the limit entirely, because
  // none of them would register until much later.
  it('blocks a run of back-to-back orders that together exceed the limit', async () => {
    await setMode('per_client', null);
    await setClientLimit(1000);
    expect((await placeOrder(600)).status).toBeLessThan(300);  // 600 committed
    const second = await placeOrder(600);                      // would reach 1200
    expect(second.status).toBe(409);
  });

  it('counts a Pending on-account order toward exposure', async () => {
    await setMode('per_client', null);
    await setClientLimit(1000);
    const first = await placeOrder(900);
    expect(first.status).toBeLessThan(300);
    const created = await mongoose.model('Order').findById(first.body.order._id).lean();
    expect(created.status).not.toBe('Completed');   // still in flight
    expect((await placeOrder(200)).status).toBe(409);
  });

  it('frees the credit back up when an order is cancelled', async () => {
    await setMode('per_client', null);
    await setClientLimit(1000);
    const first = await placeOrder(900);
    await mongoose.model('Order').updateOne(
      { _id: first.body.order._id }, { $set: { status: 'Cancelled' } }
    );
    expect((await placeOrder(900)).status).toBeLessThan(300);
  });

  it('ignores parked drafts', async () => {
    await setMode('per_client', null);
    await setClientLimit(1000);
    await mongoose.model('Order').create({
      orderNumber: 89001, customerName: 'Credit Client', clientId: String(clientId),
      status: 'Pending', isParked: true, paymentMethod: 'GCash', total: 900,
      arSettled: false, createdAt: daysAgo(1), businessType: 'log',
    });
    expect((await placeOrder(900)).status).toBeLessThan(300);
  });
});

describe('A/R ageing report', () => {
  it('buckets receivables by age and totals them', async () => {
    await owe(100, 5);      // current
    await owe(200, 45);     // 31-60
    await owe(300, 75);     // 61-90
    await owe(400, 200);    // 90+
    const res = await request(app).get('/api/finance/ar-ageing').set(auth(superToken));
    expect(res.status).toBe(200);
    expect(res.body.totals).toMatchObject({ current: 100, d31_60: 200, d61_90: 300, d90_plus: 400, total: 1000 });
  });

  it('reports each client\'s limit, headroom and over-limit flag', async () => {
    await setMode('per_client', null);
    await setClientLimit(500);
    await owe(700, 10);
    const res = await request(app).get('/api/finance/ar-ageing').set(auth(superToken));
    const row = res.body.clients.find(c => c.client === 'Credit Client');
    expect(row.creditLimit).toBe(500);
    expect(row.total).toBe(700);
    expect(row.available).toBe(0);
    expect(row.overLimit).toBe(true);
  });

  it('shows a client whose credit is spent on in-flight orders, even with ₱0 aged A/R', async () => {
    // Otherwise an owner sees "₱0 owing" for the very client being turned away.
    await setMode('per_client', null);
    await setClientLimit(1000);
    await placeOrder(600);                       // Pending - not yet a book receivable
    const res = await request(app).get('/api/finance/ar-ageing').set(auth(superToken));
    const row = res.body.clients.find(c => c.client === 'Credit Client');
    expect(row).toBeTruthy();
    expect(row.total).toBe(0);                   // nothing aged yet
    expect(row.exposure).toBe(600);              // but credit IS committed
    expect(row.available).toBe(400);
  });

  it('requires accounting permission', async () => {
    const res = await request(app).get('/api/finance/ar-ageing');
    expect(res.status).toBe(401);
  });
});
