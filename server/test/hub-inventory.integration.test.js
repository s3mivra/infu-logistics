// Hub inventory-visibility tests - a host can pull a read-only stock snapshot
// from a linked client business; nothing works in the reverse direction.
// Both ends of that rule are enforced independently: requireSuperAdmin on the
// outbound (host) route, and role==='client' on the inbound (internal) route
// that answers it - see server/features/hub.js.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let app, stop, superToken, staffToken;

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'log', jwtSecret: 'hub-inv-test-secret-0123456789' }));
  await makeUser({ name: 'HubBoss', role: 'superadmin', password: 'pw' });
  await makeUser({ name: 'HubStaff', role: 'cashier', password: 'pw' });
  await mongoose.model('User').updateMany({}, { $set: { tenantId: null } });
  superToken = await loginStaff(app, 'HubBoss', 'pw');
  staffToken = await loginStaff(app, 'HubStaff', 'pw');

  const Inventory = mongoose.model('Inventory');
  await Inventory.create({
    businessType: 'log', itemName: 'Bottled Water 500ml', itemCode: 'BW500',
    stockQty: 240, unit: 'pcs', displayUnit: 'pcs', unitMultiplier: 1, packSize: null,
  });

  const LinkedBusiness = mongoose.model('LinkedBusiness');
  // role:'client' on my own doc means the caller holding this token is MY hub
  // (I am its client) - my internal snapshot route must answer this one.
  await LinkedBusiness.create({
    businessType: 'log', role: 'client', partnerSlug: 'my-hub', partnerName: 'My Hub',
    linkToken: 'client-side-token', status: 'active',
  });
  // role:'hub' on my own doc means the caller is a business I host - it must
  // NOT be able to pull my inventory through this route.
  await LinkedBusiness.create({
    businessType: 'log', role: 'hub', partnerSlug: 'my-client', partnerName: 'My Client',
    linkToken: 'hub-side-token', status: 'active',
  });
}, 120000);

afterAll(async () => { await stop(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });

describe('hub internal inventory-snapshot (inbound, answers a caller)', () => {
  it('rejects a call with no link token', async () => {
    const res = await request(app).post('/api/hub/internal/inventory-snapshot').send({});
    expect(res.status).toBe(401);
  });

  it('rejects a call from a business I host (role:hub on my side)', async () => {
    const res = await request(app).post('/api/hub/internal/inventory-snapshot')
      .set('x-link-token', 'hub-side-token').send({});
    expect(res.status).toBe(403);
  });

  it('answers a call from my own hub (role:client on my side) with a stock snapshot', async () => {
    const res = await request(app).post('/api/hub/internal/inventory-snapshot')
      .set('x-link-token', 'client-side-token').send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.items)).toBe(true);
    const row = res.body.items.find(i => i.itemCode === 'BW500');
    expect(row).toBeTruthy();
    expect(row.stockQtyBase).toBe(240);
    expect(row.unit).toBe('pcs');
    // Never leaks cost/financial data - only stock, unit, velocity.
    expect(row.unitCost).toBeUndefined();
  });
});

describe('hub partner inventory (outbound, host pulls from a client)', () => {
  it('requires superadmin', async () => {
    const res = await request(app).get('/api/hub/partners/my-client/inventory').set(auth(staffToken));
    expect(res.status).toBe(403);
  });

  it('404s for a slug with no role:hub link', async () => {
    const res = await request(app).get('/api/hub/partners/no-such-partner/inventory').set(auth(superToken));
    expect(res.status).toBe(404);
  });

  it('404s for a partner I am only a client of (role:client, not hub)', async () => {
    // 'my-hub' exists as role:'client' on my side - I host nothing there, so
    // the outbound route (which requires role:'hub') must not find it either.
    const res = await request(app).get('/api/hub/partners/my-hub/inventory').set(auth(superToken));
    expect(res.status).toBe(404);
  });

  it('attempts to reach a real role:hub partner and surfaces a network failure rather than crashing', async () => {
    // 'my-client' is a genuine role:'hub' link, so the route gets past its own
    // checks and calls partnerCall() - which fails here because there's no
    // real partner server to answer it in this test. That failure should come
    // back as a clean 502, not an unhandled exception.
    const res = await request(app).get('/api/hub/partners/my-client/inventory').set(auth(superToken));
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/my-client/);
  });
});
