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
