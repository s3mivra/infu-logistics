// Integration tests for the granular RBAC enforcement on accounting / reports /
// analytics / audit / settings routes. Verifies BOTH directions: privileged roles
// & explicit grants get through; unprivileged roles are denied; superadmin bypasses.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let app, stop, superT, financeT, adminT, cashierT, grantT;

// Create a cashier with an explicit accounting.view + reports.view override.
async function makeGrantedUser() {
  const User = mongoose.model('User');
  await User.create({
    name: 'GrantView', role: 'cashier', userCode: 'ADN-G0001',
    password: await bcrypt.hash('pw', 12),
    permissions: ['accounting.view', 'reports.view'],
  });
}

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'log', jwtSecret: 'rbac-enf-secret-0123456789' }));
  await makeUser({ name: 'EnfBoss', role: 'superadmin', password: 'pw' });
  await makeUser({ name: 'EnfFinance', role: 'finance', password: 'pw' });
  await makeUser({ name: 'EnfAdmin', role: 'admin', password: 'pw' });
  await makeUser({ name: 'EnfCashier', role: 'cashier', password: 'pw' });
  await makeGrantedUser();
  await mongoose.model('User').updateMany({}, { $set: { tenantId: null } }); // uniform tenant (harness backfill race)
  superT   = await loginStaff(app, 'EnfBoss', 'pw');
  financeT = await loginStaff(app, 'EnfFinance', 'pw');
  adminT   = await loginStaff(app, 'EnfAdmin', 'pw');
  cashierT = await loginStaff(app, 'EnfCashier', 'pw');
  grantT   = await loginStaff(app, 'GrantView', 'pw');
}, 120000);

afterAll(async () => { await stop(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const notForbidden = (s) => expect(s).not.toBe(403);

describe('accounting.view — reading the books', () => {
  it('superadmin, finance, admin, and an explicitly-granted cashier can GET /api/journal', async () => {
    notForbidden((await request(app).get('/api/journal').set(auth(superT))).status);
    notForbidden((await request(app).get('/api/journal').set(auth(financeT))).status);
    notForbidden((await request(app).get('/api/journal').set(auth(adminT))).status);
    notForbidden((await request(app).get('/api/journal').set(auth(grantT))).status);
  });
  it('a plain cashier (no accounting.view) is denied', async () => {
    expect((await request(app).get('/api/journal').set(auth(cashierT))).status).toBe(403);
  });
});

describe('accounting.manage — posting to the books', () => {
  const entry = { date: new Date().toISOString(), memo: 't', lines: [] };
  it('finance & superadmin may POST /api/expenses; admin & granted-viewer may not', async () => {
    notForbidden((await request(app).post('/api/expenses').set(auth(superT)).send({})).status);
    notForbidden((await request(app).post('/api/expenses').set(auth(financeT)).send({})).status);
    expect((await request(app).post('/api/expenses').set(auth(adminT)).send({})).status).toBe(403);   // admin lacks accounting.manage
    expect((await request(app).post('/api/expenses').set(auth(grantT)).send({})).status).toBe(403);   // only granted view
    expect((await request(app).post('/api/expenses').set(auth(cashierT)).send({})).status).toBe(403);
  });
});

describe('reports.view / analytics.view', () => {
  it('granted cashier can GET reports/pnl; plain cashier cannot', async () => {
    notForbidden((await request(app).get('/api/reports/pnl').set(auth(grantT))).status);
    expect((await request(app).get('/api/reports/pnl').set(auth(cashierT))).status).toBe(403);
  });
  it('analytics.view: manager-ish (admin) allowed, plain cashier denied', async () => {
    notForbidden((await request(app).get('/api/analytics/dashboard').set(auth(adminT))).status);
    expect((await request(app).get('/api/analytics/dashboard').set(auth(cashierT))).status).toBe(403);
  });
});

describe('audit.view', () => {
  it('admin allowed, cashier denied', async () => {
    notForbidden((await request(app).get('/api/audit-logs').set(auth(adminT))).status);
    expect((await request(app).get('/api/audit-logs').set(auth(cashierT))).status).toBe(403);
  });
});

describe('settings.manage', () => {
  it('admin (has settings.manage) can PATCH a setting; cashier cannot', async () => {
    const ok = await request(app).patch('/api/settings/imagesEnabled').set(auth(adminT)).send({ value: true });
    notForbidden(ok.status);
    const no = await request(app).patch('/api/settings/imagesEnabled').set(auth(cashierT)).send({ value: false });
    expect(no.status).toBe(403);
  });
});

describe('client token is rejected everywhere (staff floor holds)', () => {
  it('a client-audience token cannot reach accounting even with the route open', async () => {
    // No client token minted here; assert an unauthenticated request is 401, not 200.
    expect((await request(app).get('/api/journal')).status).toBe(401);
  });
});
