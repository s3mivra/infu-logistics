// Duplicate-submit protection: a laggy connection must not turn one press of a
// Create button into several records. See lib/idempotency.js for the design.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let app, stop, superToken;

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'fb', jwtSecret: 'idem-test-secret-0123456789' }));
  await makeUser({ name: 'IdemBoss', role: 'superadmin', password: 'pw' });
  superToken = await loginStaff(app, 'IdemBoss', 'pw');
}, 120000);

afterAll(async () => { await stop(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });

describe('duplicate submit protection', () => {
  it('three concurrent identical creates produce one record', async () => {
    const Supplier = mongoose.model('Supplier');
    const before = await Supplier.countDocuments({ name: 'Lag Test Supplier' });
    expect(before).toBe(0);

    // Exactly the reported scenario: the button is pressed repeatedly because
    // the first response has not come back yet, so all three are in flight.
    const body = { name: 'Lag Test Supplier', contactPerson: 'Ana', terms: 30 };
    const results = await Promise.all([
      request(app).post('/api/suppliers').set(auth(superToken)).send(body),
      request(app).post('/api/suppliers').set(auth(superToken)).send(body),
      request(app).post('/api/suppliers').set(auth(superToken)).send(body),
    ]);

    // One record, not three - the whole point.
    expect(await Supplier.countDocuments({ name: 'Lag Test Supplier' })).toBe(1);

    // And every caller is told it worked, rather than two of them seeing an
    // error they would have to interpret.
    for (const r of results) expect(r.status).toBeLessThan(400);
    const replays = results.filter(r => r.headers['x-idempotent-replay'] === '1');
    expect(replays.length).toBe(2);
  });

  it('sequential identical creates are NOT collapsed - two real sales are two sales', async () => {
    // Orders, not suppliers: a supplier name is unique by rule, but two
    // customers really can buy the same single coffee moments apart, and each
    // must be rung up. A naive "ignore repeats for N seconds" would swallow the
    // second sale and lose the money; in-flight collapsing must not.
    const body = { items: [{ name: 'Espresso', price: 120, quantity: 1 }], table: 'Takeout', paymentMethod: 'Cash' };
    const first = await request(app).post('/api/orders').set(auth(superToken)).send(body);
    expect(first.status).toBeLessThan(400);
    const second = await request(app).post('/api/orders').set(auth(superToken)).send(body);
    expect(second.status).toBeLessThan(400);
    expect(second.headers['x-idempotent-replay']).toBeUndefined();
    expect(first.body.order.orderNumber).not.toBe(second.body.order.orderNumber);
  });

  it('different payloads in flight together are both created', async () => {
    const Supplier = mongoose.model('Supplier');
    const [a, b] = await Promise.all([
      request(app).post('/api/suppliers').set(auth(superToken)).send({ name: 'Concurrent A' }),
      request(app).post('/api/suppliers').set(auth(superToken)).send({ name: 'Concurrent B' }),
    ]);
    expect(a.status).toBeLessThan(400);
    expect(b.status).toBeLessThan(400);
    expect(await Supplier.countDocuments({ name: { $in: ['Concurrent A', 'Concurrent B'] } })).toBe(2);
  });

  it('an explicit Idempotency-Key replays the original response after it finished', async () => {
    const Supplier = mongoose.model('Supplier');
    const body = { name: 'Keyed Supplier', contactPerson: 'Cara' };
    const key = 'submit-attempt-0001';
    const first = await request(app).post('/api/suppliers').set({ ...auth(superToken), 'Idempotency-Key': key }).send(body);
    expect(first.status).toBeLessThan(400);
    // Sequential, not concurrent - only the explicit key can catch this. It is
    // what protects a reload or a second tab re-submitting the same form.
    const again = await request(app).post('/api/suppliers').set({ ...auth(superToken), 'Idempotency-Key': key }).send(body);
    expect(again.headers['x-idempotent-replay']).toBe('1');
    expect(await Supplier.countDocuments({ name: 'Keyed Supplier' })).toBe(1);
  });

  it('concurrent orders are collapsed too - the costliest duplicate', async () => {
    const Order = mongoose.model('Order');
    const body = { items: [{ name: 'Latte', price: 150, quantity: 1 }], table: 'Takeout', paymentMethod: 'Cash' };
    const results = await Promise.all([
      request(app).post('/api/orders').set(auth(superToken)).send(body),
      request(app).post('/api/orders').set(auth(superToken)).send(body),
    ]);
    for (const r of results) expect(r.status).toBeLessThan(400);
    const numbers = new Set(results.map(r => r.body?.order?.orderNumber).filter(Boolean));
    // Both callers were handed the SAME order, so the POS shows one sale.
    expect(numbers.size).toBe(1);
    expect(await Order.countDocuments({ orderNumber: [...numbers][0] })).toBe(1);
  });

  it('GET requests are untouched', async () => {
    const a = await request(app).get('/api/suppliers').set(auth(superToken));
    const b = await request(app).get('/api/suppliers').set(auth(superToken));
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(b.headers['x-idempotent-replay']).toBeUndefined();
  });

  it('login is exempt - two sessions must not share one response', async () => {
    const [a, b] = await Promise.all([
      request(app).post('/api/users/login').send({ name: 'IdemBoss', password: 'pw' }),
      request(app).post('/api/users/login').send({ name: 'IdemBoss', password: 'pw' }),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(b.headers['x-idempotent-replay']).toBeUndefined();
  });
});
