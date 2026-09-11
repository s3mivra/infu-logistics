// Tenancy Health, one collection at a time.
//
// The report used to be a single request answering every collection at once,
// which a screen can only draw as a spinner - and a spinner cannot tell "nearly
// done" from "stuck". The list and per-collection endpoints let the client walk
// the collections and show a progress bar that counts real work.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let app, stop, superToken, cashierToken;

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'fb', jwtSecret: 'tenancy-progress-0123456789' }));
  await makeUser({ name: 'ProgBoss', role: 'superadmin', password: 'pw' });
  await makeUser({ name: 'ProgCashier', role: 'cashier', password: 'pw' });
  superToken = await loginStaff(app, 'ProgBoss', 'pw');
  cashierToken = await loginStaff(app, 'ProgCashier', 'pw');
}, 120000);

afterAll(async () => { await stop(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });

describe('tenancy report, per collection', () => {
  it('lists the collections to scan', async () => {
    const res = await request(app).get('/api/admin/tenancy-report/collections').set(auth(superToken));
    expect(res.status).toBe(200);
    expect(res.body.currentBusinessType).toBe('fb');
    expect(res.body.collections).toContain('Bill');
    expect(res.body.collections).toContain('PurchaseOrder');
    // Excluded for the same reason as the full report.
    expect(res.body.collections).not.toContain('Tenant');
  });

  it('counts one collection', async () => {
    await mongoose.model('Bill').collection.insertOne({ supplierName: 'Progress Unstamped', total: 10 });
    const res = await request(app).get('/api/admin/tenancy-report?collection=Bill').set(auth(superToken));
    expect(res.status).toBe(200);
    expect(res.body.row.collection).toBe('Bill');
    expect(res.body.row.missingBusinessType).toBeGreaterThanOrEqual(1);
    expect(res.body.row.timedOut).toBe(false);
  });

  it('agrees with the full report for the same collection', async () => {
    const one = await request(app).get('/api/admin/tenancy-report?collection=Bill').set(auth(superToken));
    const full = await request(app).get('/api/admin/tenancy-report').set(auth(superToken));
    const fromFull = full.body.rows.find(r => r.collection === 'Bill');
    // Both paths share one counting function; they must never disagree.
    expect(one.body.row).toEqual(fromFull);
  });

  it('refuses anything that is not a scanned collection', async () => {
    // Otherwise the endpoint would count documents in any model by name.
    const excluded = await request(app).get('/api/admin/tenancy-report?collection=Tenant').set(auth(superToken));
    expect(excluded.status).toBe(404);
    const unknown = await request(app).get('/api/admin/tenancy-report?collection=NotAModel').set(auth(superToken));
    expect(unknown.status).toBe(404);
  });

  it('is superadmin-only in both modes', async () => {
    const list = await request(app).get('/api/admin/tenancy-report/collections').set(auth(cashierToken));
    expect(list.status).toBeGreaterThanOrEqual(400);
    const one = await request(app).get('/api/admin/tenancy-report?collection=Bill').set(auth(cashierToken));
    expect(one.status).toBeGreaterThanOrEqual(400);
  });
});
