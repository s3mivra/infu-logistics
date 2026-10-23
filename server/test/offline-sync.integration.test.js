// Offline selling: a till that lost its connection queues the sale with a
// client-made Idempotency-Key and replays it when the WiFi returns. The
// replay can happen more than once - the first attempt reached the server but
// the answer never got back, a second tab flushed too, the queue was restored
// from IndexedDB - and every one of those must land as ONE sale.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let app, stop, token;

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'fb', jwtSecret: 'offline-sync-secret-0123456789' }));
  await makeUser({ name: 'SyncBoss', role: 'superadmin', password: 'pw' });
  token = await loginStaff(app, 'SyncBoss', 'pw');
}, 120000);

afterAll(async () => { await stop(); });

const post = (key, body) => request(app).post('/api/orders')
  .set({ Authorization: `Bearer ${token}`, 'Idempotency-Key': key }).send(body);

describe('offline order sync', () => {
  it('replaying a queued sale after it already landed returns the same order', async () => {
    const Order = mongoose.model('Order');
    const key = 'q_offline_replay_0001';
    const body = { items: [{ name: 'Mocha', price: 160, quantity: 2 }], table: 'Takeout', paymentMethod: 'Cash', placedAt: new Date(Date.now() - 60_000).toISOString() };
    const first = await post(key, body);
    expect(first.status).toBeLessThan(400);
    const number = first.body?.order?.orderNumber;
    expect(number).toBeTruthy();

    // The sync loop runs again (the first response was lost on the way back).
    const again = await post(key, body);
    expect(again.status).toBeLessThan(400);
    expect(again.body?.order?.orderNumber).toBe(number);
    expect(await Order.countDocuments({ idempotencyKey: key })).toBe(1);
  });

  it('two tabs flushing the same queue at once still make one sale', async () => {
    const Order = mongoose.model('Order');
    const key = 'q_offline_race_0002';
    const body = { items: [{ name: 'Cortado', price: 140, quantity: 1 }], table: 'Takeout', paymentMethod: 'Cash' };
    const results = await Promise.all([post(key, body), post(key, body), post(key, body)]);
    for (const r of results) expect(r.status).toBeLessThan(400);
    expect(new Set(results.map(r => r.body?.order?.orderNumber)).size).toBe(1);
    expect(await Order.countDocuments({ idempotencyKey: key })).toBe(1);
  });

  it('different queued sales with their own keys are all recorded', async () => {
    const Order = mongoose.model('Order');
    const body = { items: [{ name: 'Americano', price: 120, quantity: 1 }], table: 'Takeout', paymentMethod: 'Cash' };
    const a = await post('q_offline_distinct_a', body);
    const b = await post('q_offline_distinct_b', body);
    expect(a.body?.order?.orderNumber).not.toBe(b.body?.order?.orderNumber);
    expect(await Order.countDocuments({ idempotencyKey: { $in: ['q_offline_distinct_a', 'q_offline_distinct_b'] } })).toBe(2);
  });
});

