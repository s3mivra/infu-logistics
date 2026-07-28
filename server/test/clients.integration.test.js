// Clients overview — accounts joined to their orders and receivables.
// Risks covered: attributing orders through EITHER identity field, keeping the
// A/R vs exposure distinction straight, and not leaking money columns to roles
// without accounting.view.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let app, stop, superToken, cashierToken, clientA, clientB;

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const daysAgo = (n) => new Date(Date.now() - n * 86400000);
const summary = async (tok) => (await request(app).get('/api/clients/summary').set(auth(tok))).body;
const rowFor = (b, name) => b.clients.find(c => c.name === name);

const mkClient = async (username, name) => {
  const c = await mongoose.model('ClientAccount').create({
    clientCode: `CUS-1000-A${Math.floor(Math.random() * 9000 + 1000)}`,
    username, password: await bcrypt.hash('pw1234', 4), name, paymentMethod: 'GCash',
  });
  return String(c._id);
};

const mkOrder = (attrs) => mongoose.model('Order').create({
  orderNumber: 70000 + Math.floor(Math.random() * 9999),
  status: 'Completed', paymentMethod: 'GCash', total: 100,
  arSettled: false, createdAt: new Date(), businessType: 'log', ...attrs,
});

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'log', jwtSecret: 'clients-test-secret-0123456789' }));
  await makeUser({ name: 'CliBoss', role: 'superadmin', password: 'pw' });
  await makeUser({ name: 'CliCashier', role: 'cashier', password: 'pw' });
  await mongoose.model('User').updateMany({}, { $set: { tenantId: null } });
  superToken = await loginStaff(app, 'CliBoss', 'pw');
  cashierToken = await loginStaff(app, 'CliCashier', 'pw');

  clientA = await mkClient('portalclient', 'Portal Client');
  clientB = await mkClient('behalfclient', 'Behalf Client');

  // Portal-shaped orders carry clientId only.
  await mkOrder({ clientId: clientA, customerName: 'Portal Client', total: 400, createdAt: daysAgo(5) });
  await mkOrder({ clientId: clientA, customerName: 'Portal Client', total: 600, createdAt: daysAgo(45) });
  // On-behalf orders carry clientAccountId only.
  await mkOrder({ clientAccountId: clientB, customerName: 'Behalf Client', total: 250, createdAt: daysAgo(2) });
  // Cash + cancelled must not become receivables.
  await mkOrder({ clientId: clientA, paymentMethod: 'Cash', total: 999, createdAt: daysAgo(1) });
  await mkOrder({ clientId: clientA, status: 'Cancelled', total: 5000, createdAt: daysAgo(1) });
}, 120000);

afterAll(async () => { await stop(); });

describe('client attribution', () => {
  it('counts orders placed through the portal (clientId)', async () => {
    const b = await summary(superToken);
    expect(rowFor(b, 'Portal Client').orderCount).toBe(4);
  });

  it('counts orders placed on the client\'s behalf (clientAccountId)', async () => {
    const b = await summary(superToken);
    expect(rowFor(b, 'Behalf Client').orderCount).toBe(1);
  });

  it('does not mix one client\'s orders into another', async () => {
    const b = await summary(superToken);
    expect(rowFor(b, 'Behalf Client').exposure).toBe(250);
  });

  it('lists clients with no orders at all', async () => {
    await mkClient('quietclient', 'Quiet Client');
    const b = await summary(superToken);
    const row = rowFor(b, 'Quiet Client');
    expect(row).toBeTruthy();
    expect(row.orderCount).toBe(0);
    expect(row.exposure).toBe(0);
  });
});

describe('money columns', () => {
  it('ages receivables into buckets', async () => {
    const b = await summary(superToken);
    const row = rowFor(b, 'Portal Client');
    expect(row.aged.current).toBe(400);   // 5 days
    expect(row.aged.d31_60).toBe(600);    // 45 days
    expect(row.aged.total).toBe(1000);
  });

  it('excludes cash and cancelled orders from receivables', async () => {
    const b = await summary(superToken);
    const row = rowFor(b, 'Portal Client');
    expect(row.aged.total).toBe(1000);    // not 1000 + 999 cash + 5000 cancelled
    expect(row.exposure).toBe(1000);
  });

  it('reports credit limit and headroom once a mode is active', async () => {
    await request(app).patch('/api/settings/creditLimitMode').set(auth(superToken)).send({ value: 'global' });
    await request(app).patch('/api/settings/globalCreditLimit').set(auth(superToken)).send({ value: 1200 });
    const b = await summary(superToken);
    const row = rowFor(b, 'Portal Client');
    expect(row.creditLimit).toBe(1200);
    expect(row.available).toBe(200);
    expect(row.overLimit).toBe(false);
  });

  it('flags a client over their limit', async () => {
    await request(app).patch('/api/settings/globalCreditLimit').set(auth(superToken)).send({ value: 500 });
    const b = await summary(superToken);
    expect(rowFor(b, 'Portal Client').overLimit).toBe(true);
    expect(rowFor(b, 'Portal Client').available).toBe(0);
  });
});

describe('permission scoping', () => {
  it('hides money columns from a role without accounting.view', async () => {
    const b = await summary(cashierToken);
    expect(b.showMoney).toBe(false);
    const row = rowFor(b, 'Portal Client');
    expect(row.orderCount).toBe(4);          // still sees who the clients are
    expect(row.exposure).toBeUndefined();    // but not what they owe
    expect(row.creditLimit).toBeUndefined();
    expect(row.aged).toBeUndefined();
  });

  it('requires authentication', async () => {
    expect((await request(app).get('/api/clients/summary')).status).toBe(401);
  });
});

describe('per-client order list', () => {
  it('returns that client\'s orders, newest first', async () => {
    const res = await request(app).get(`/api/clients/${clientA}/orders`).set(auth(superToken));
    expect(res.status).toBe(200);
    expect(res.body.orders.length).toBe(4);
    const dates = res.body.orders.map(o => new Date(o.createdAt).getTime());
    expect(dates).toEqual([...dates].sort((a, z) => z - a));
  });

  it('summarises items as a count rather than shipping the whole basket', async () => {
    const res = await request(app).get(`/api/clients/${clientA}/orders`).set(auth(superToken));
    expect(res.body.orders[0]).toHaveProperty('itemCount');
    expect(res.body.orders[0].items).toBeUndefined();
  });

  it('404s on a malformed id', async () => {
    expect((await request(app).get('/api/clients/not-an-id/orders').set(auth(superToken))).status).toBe(404);
  });
});
