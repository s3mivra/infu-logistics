// Multi-tenancy Phase 1 integration tests — Tenant model, default-tenant seed +
// tenantId backfill, and superadmin /api/tenants CRUD. Phase 1 is additive and
// non-breaking, so these assert the foundation exists without changing query behavior.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let app, stop, superToken, cashierToken;

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'fb', jwtSecret: 'tenancy-test-secret-0123456789' }));
  await makeUser({ name: 'TenantBoss', role: 'superadmin', password: 'pw' });
  await makeUser({ name: 'TenantCashier', role: 'cashier', password: 'pw' });
  superToken = await loginStaff(app, 'TenantBoss', 'pw');
  cashierToken = await loginStaff(app, 'TenantCashier', 'pw');
}, 120000);

afterAll(async () => { await stop(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });

describe('default tenant seed + backfill', () => {
  it('seeds a "default" tenant on boot', async () => {
    const Tenant = mongoose.model('Tenant');
    const def = await Tenant.findOne({ slug: 'default' });
    expect(def).toBeTruthy();
    expect(def.businessType).toBe('fb');
  });
  it('backfills tenantId on new tenant-scoped docs (default)', async () => {
    const Product = mongoose.model('Product');
    const Tenant = mongoose.model('Tenant');
    const def = await Tenant.findOne({ slug: 'default' });
    // A legacy-style doc inserted without tenantId, then backfilled by re-running startup.
    await Product.collection.insertOne({ name: 'Legacy', basePrice: 1, businessType: 'fb' });
    const { runStartupTasks } = await import('../server.js');
    await runStartupTasks();
    const p = await Product.findOne({ name: 'Legacy' });
    expect(String(p.tenantId)).toBe(String(def._id));
  });
});

describe('/api/tenants CRUD (superadmin only)', () => {
  it('cashier is forbidden', async () => {
    const res = await request(app).get('/api/tenants').set(auth(cashierToken));
    expect(res.status).toBe(403);
  });
  it('superadmin lists tenants (incl. default)', async () => {
    const res = await request(app).get('/api/tenants').set(auth(superToken));
    expect(res.status).toBe(200);
    expect(res.body.tenants.some(t => t.slug === 'default')).toBe(true);
  });
  it('creates, updates, and protects/deletes tenants', async () => {
    const create = await request(app).post('/api/tenants').set(auth(superToken))
      .send({ name: 'Branch Two', slug: 'branch-two', businessType: 'fb' });
    expect(create.status).toBe(200);
    const id = create.body.tenant._id;

    const dupe = await request(app).post('/api/tenants').set(auth(superToken))
      .send({ name: 'Dup', slug: 'branch-two' });
    expect(dupe.status).toBe(409);

    const bad = await request(app).post('/api/tenants').set(auth(superToken)).send({ name: 'X' });
    expect(bad.status).toBe(422); // missing slug

    const patch = await request(app).patch(`/api/tenants/${id}`).set(auth(superToken)).send({ isActive: false });
    expect(patch.status).toBe(200);
    expect(patch.body.tenant.isActive).toBe(false);

    const del = await request(app).delete(`/api/tenants/${id}`).set(auth(superToken));
    expect(del.status).toBe(200);
  });
  it('refuses to delete the default tenant', async () => {
    const Tenant = mongoose.model('Tenant');
    const def = await Tenant.findOne({ slug: 'default' });
    const res = await request(app).delete(`/api/tenants/${def._id}`).set(auth(superToken));
    expect(res.status).toBe(400);
  });
});

describe('Phase 2a — tenant identity in the access token', () => {
  it('staff access token carries the user tenantId after backfill', async () => {
    const Tenant = mongoose.model('Tenant');
    const def = await Tenant.findOne({ slug: 'default' });
    // Backfill stamps existing users (incl. TenantBoss) with the default tenant.
    const { runStartupTasks } = await import('../server.js');
    await runStartupTasks();
    const res = await request(app).post('/api/users/login').send({ name: 'TenantBoss', password: 'pw' });
    expect(res.status).toBe(200);
    const payload = JSON.parse(Buffer.from(res.body.token.split('.')[1], 'base64').toString());
    expect(String(payload.tenantId)).toBe(String(def._id));
  });

  it('a newly created user inherits the creator tenant', async () => {
    const Tenant = mongoose.model('Tenant');
    const User = mongoose.model('User');
    const def = await Tenant.findOne({ slug: 'default' });
    const { runStartupTasks } = await import('../server.js');
    await runStartupTasks(); // ensure the creator (TenantBoss) is stamped
    // Re-login to get a token that carries the now-backfilled tenantId.
    const fresh = (await request(app).post('/api/users/login').send({ name: 'TenantBoss', password: 'pw' })).body.token;
    const res = await request(app).post('/api/users').set(auth(fresh))
      .send({ name: 'InheritUser', password: 'secret1', role: 'cashier' });
    expect(res.status).toBe(200);
    const created = await User.findOne({ name: 'InheritUser' });
    expect(String(created.tenantId)).toBe(String(def._id));
  });
});

describe('Phase 2b — per-tenant read scoping: DISABLED (tenantScope is now a no-op)', () => {
  // Phase 2b's premise ("all current data lives on the default tenant, so this
  // is a no-op until >1 tenant exists") didn't hold in practice: the boot
  // migration backfills tenantId onto EXISTING users, but nothing stamps
  // tenantId onto newly-created Orders/Inventory/etc. going forward — those
  // default to null. Once the backfill has run, every staff token carries a
  // tenantId while every fresh order does not, so filtering reads by tenantId
  // silently hid all new data (this was the real-world root cause of "orders
  // not showing up"). Per this project's single-tenant-per-deployment
  // direction, tenantScope now always returns {} — this test asserts that,
  // instead of asserting isolation that no longer applies.
  it('tenant-scoped orders are visible to every staff token regardless of tenantId', async () => {
    const Tenant = mongoose.model('Tenant');
    const Order = mongoose.model('Order');
    const User = mongoose.model('User');
    const def = await Tenant.findOne({ slug: 'default' });
    const tB = await Tenant.create({ name: 'Scope Tenant B', slug: 'scope-b', businessType: 'fb' });

    await Order.create({ orderNumber: 'ORD-SA-1', businessType: 'fb', tenantId: def._id, status: 'Preparing' });
    await Order.create({ orderNumber: 'ORD-SB-1', businessType: 'fb', tenantId: tB._id, status: 'Preparing' });

    await makeUser({ name: 'ScopeA', role: 'cashier', password: 'pw' });
    await User.updateOne({ name: 'ScopeA' }, { $set: { tenantId: def._id } });
    const tokA = (await request(app).post('/api/users/login').send({ name: 'ScopeA', password: 'pw' })).body.token;

    await makeUser({ name: 'ScopeB', role: 'cashier', password: 'pw' });
    await User.updateOne({ name: 'ScopeB' }, { $set: { tenantId: tB._id } });
    const tokB = (await request(app).post('/api/users/login').send({ name: 'ScopeB', password: 'pw' })).body.token;

    // Both tokens see BOTH orders now — no tenant filtering.
    const aNums = (await request(app).get('/api/orders').set(auth(tokA))).body.orders.map(o => o.orderNumber);
    const bNums = (await request(app).get('/api/orders').set(auth(tokB))).body.orders.map(o => o.orderNumber);
    expect(aNums).toContain('ORD-SA-1');  expect(aNums).toContain('ORD-SB-1');
    expect(bNums).toContain('ORD-SA-1');  expect(bNums).toContain('ORD-SB-1');

    await makeUser({ name: 'LegacyNoTenant', role: 'cashier', password: 'pw' });
    const tokL = (await request(app).post('/api/users/login').send({ name: 'LegacyNoTenant', password: 'pw' })).body.token;
    const lNums = (await request(app).get('/api/orders').set(auth(tokL))).body.orders.map(o => o.orderNumber);
    expect(lNums).toContain('ORD-SA-1');  expect(lNums).toContain('ORD-SB-1');
  });

  // Regression for the actual production bug: a real order created through the
  // API (tenantId defaults to null, same as every live order) must be visible
  // to a staff member whose token carries a backfilled tenantId.
  it('regression: a freshly-created order (tenantId null) is visible to a staff token with a backfilled tenantId', async () => {
    const Tenant = mongoose.model('Tenant');
    const User = mongoose.model('User');
    const def = await Tenant.findOne({ slug: 'default' });

    await makeUser({ name: 'BackfilledCashier', role: 'cashier', password: 'pw' });
    await User.updateOne({ name: 'BackfilledCashier' }, { $set: { tenantId: def._id } });
    const tok = (await request(app).post('/api/users/login').send({ name: 'BackfilledCashier', password: 'pw' })).body.token;

    const create = await request(app).post('/api/orders').set(auth(tok))
      .send({ items: [{ name: 'Regression Item', price: 10, quantity: 1 }], table: 'Takeout', paymentMethod: 'Cash' });
    expect(create.status).toBe(200);

    const list = await request(app).get('/api/orders').set(auth(tok));
    expect(list.body.orders.map(o => o.orderNumber)).toContain(create.body.order.orderNumber);
  });
});
