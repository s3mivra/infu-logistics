// Two Locations, One System: orders can now carry a `location` tag (set by
// the device via the POS "Branch" picker), and /api/analytics/by-location
// groups Completed orders by it so branches can be compared. Untagged orders
// must land in "(Unassigned)", never get dropped.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let app, stop, superToken;
const auth = (t) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'log', jwtSecret: 'branch-test-secret-0123456789' }));
  await makeUser({ name: 'BranchBoss', role: 'superadmin', password: 'pw' });
  await mongoose.model('User').updateMany({}, { $set: { tenantId: null } });
  superToken = await loginStaff(app, 'BranchBoss', 'pw');
}, 120000);

afterAll(async () => { await stop(); });

const placeOrder = async (location, total) => {
  const res = await request(app).post('/api/orders').set(auth(superToken))
    .send({ items: [{ name: 'Widget', price: total, quantity: 1 }], table: 'Takeout', customerName: 'Guest', location });
  expect(res.body.success).toBe(true);
  const id = res.body.order._id;
  await request(app).put(`/api/orders/${id}`).set(auth(superToken)).send({ status: 'Completed', paymentMethod: 'Cash' });
  return id;
};

describe('branch comparison', () => {
  it('tags an order with location and groups revenue by branch', async () => {
    await placeOrder('Branch A', 100);
    await placeOrder('Branch A', 200);
    await placeOrder('Branch B', 50);
    await placeOrder('', 25); // untagged - must land in (Unassigned), not vanish

    const res = await request(app).get('/api/analytics/by-location').set(auth(superToken));
    expect(res.body.success).toBe(true);
    const byName = Object.fromEntries(res.body.locations.map(l => [l.location, l]));
    expect(byName['Branch A'].allTimeRevenue).toBeGreaterThanOrEqual(300);
    expect(byName['Branch A'].allTimeOrders).toBeGreaterThanOrEqual(2);
    expect(byName['Branch B'].allTimeRevenue).toBeGreaterThanOrEqual(50);
    expect(byName['(Unassigned)'].allTimeRevenue).toBeGreaterThanOrEqual(25);
    expect(res.body.hasLocationData).toBe(true);
  });

  it('computes avg ticket correctly per branch', async () => {
    const res = await request(app).get('/api/analytics/by-location').set(auth(superToken));
    const a = res.body.locations.find(l => l.location === 'Branch A');
    expect(a.avgTicket).toBeCloseTo(a.allTimeRevenue / a.allTimeOrders, 2);
  });
});
