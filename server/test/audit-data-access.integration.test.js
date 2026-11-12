// 2026-11 audit: back-office reads need their screen's permission (M20), the
// anonymous endpoints have their own rate buckets (M113), logs carry no secrets
// (M79), payroll snapshots are sealed and staff deletes are audited (M76), and
// a client's acceptance of the privacy notice is recorded (M77).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';
import { logSafeUrl } from '../lib/errorLog.js';

let ctx, app, superTok, cashierTok, stockTok;
const M = (n) => mongoose.model(n);
const as = (tok) => (path) => request(app).get(path).set('Authorization', `Bearer ${tok}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'DaOwner', role: 'superadmin' });
  await makeUser({ name: 'DaCashier', role: 'staff', permissions: ['pos.use', 'orders.view', 'orders.manage'] });
  await makeUser({ name: 'DaStock', role: 'staff', permissions: ['inventory.view', 'inventory.count'] });
  superTok = await loginStaff(app, 'DaOwner');
  cashierTok = await loginStaff(app, 'DaCashier');
  stockTok = await loginStaff(app, 'DaStock');
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('back-office reads need the screen that shows them (M20)', () => {
  const gated = ['/api/hub/network-summary', '/api/hub/info', '/api/inventory/eod-history', '/api/stock-transfers',
    '/api/production-orders', '/api/revolving-funds', '/api/sales', '/api/settings/readiness', '/api/roles'];

  it('a cashier is refused each of them', async () => {
    for (const p of gated) expect((await as(cashierTok)(p)).status, p).toBe(403);
  });

  it('the till\'s own reads still answer for a cashier', async () => {
    for (const p of ['/api/settings', '/api/discounts', '/api/coa', '/api/orders', '/api/users/operators']) {
      expect((await as(cashierTok)(p)).status, p).toBe(200);
    }
  });

  it('someone with the screen\'s permission gets in', async () => {
    expect((await as(stockTok)('/api/inventory/eod-history')).status).toBe(200);
    expect((await as(stockTok)('/api/stock-transfers')).status).toBe(200);
    expect((await as(superTok)('/api/roles')).status).toBe(200);
  });

  it('only GETs are gated here; writes keep their own route checks', async () => {
    const r = await request(app).post('/api/revolving-funds').set('Authorization', `Bearer ${cashierTok}`).send({});
    expect(r.body.error || '').not.toMatch(/needs one of/);
  });
});

describe('anonymous endpoints have their own buckets (M113)', () => {
  it('guessing onboarding links runs out after 20 tries from one address', async () => {
    let last;
    for (let i = 0; i < 21; i++) last = await request(app).get(`/api/client-onboard/guess-${i}`);
    expect(last.status).toBe(429);
    // ...while a signed-in screen from the same address is untouched.
    expect((await as(superTok)('/api/settings')).status).toBe(200);
  });
});

describe('logs (M79)', () => {
  it('drop query strings and onboarding tokens', () => {
    expect(logSafeUrl('/api/orders?search=Maria%20Santos')).toBe('/api/orders');
    expect(logSafeUrl('/api/client-onboard/9f8e7d6c5b?x=1')).toBe('/api/client-onboard/:token');
  });
});

describe('personal data (M76)', () => {
  it('payroll run snapshots keep government numbers sealed at rest and plain to read', async () => {
    const run = await M('PayrollRun').create({
      reference: 'PAY-TEST-1', periodStart: new Date('2026-10-01'), periodEnd: new Date('2026-10-15'), payDate: new Date('2026-10-16'),
      lines: [{ employeeName: 'Ana', tin: '123-456-789-000', sssNumber: '34-1234567-8' }],
    });
    const raw = await mongoose.connection.db.collection(M('PayrollRun').collection.collectionName).findOne({ _id: run._id });
    expect(raw.lines[0].tin).toMatch(/^v1\./);
    expect(raw.lines[0].sssNumber).toMatch(/^v1\./);
    const read = await M('PayrollRun').findById(run._id).lean();
    expect(read.lines[0].tin).toBe('123-456-789-000');
  });

  it('deleting a staff account leaves an audit row naming who and whom', async () => {
    await makeUser({ name: 'LeavingSoon', role: 'staff', permissions: ['pos.use'] });
    const u = await M('User').findOne({ name: 'LeavingSoon' }).lean();
    const del = await request(app).delete(`/api/users/${u._id}`).set('Authorization', `Bearer ${superTok}`);
    expect(del.status).toBe(200);
    const row = await M('AuditLog').findOne({ action: 'User_DELETE', targetReference: String(u._id) }).lean();
    expect(row).toBeTruthy();
    expect(row.userId).toBe('DaOwner');
    expect(row.details.before.name).toBe('LeavingSoon');
  });
});

describe('consent (M77)', () => {
  it('finishing client onboarding records which privacy notice was accepted, and when', async () => {
    const client = await M('ClientAccount').create({ clientCode: 'CLT-CONSENT', name: 'Consent Co', username: `pending-${Date.now()}`, password: 'x', paymentMethod: 'Cash' });
    const link = await request(app).post(`/api/client-accounts/${client._id}/onboard-link`).set('Authorization', `Bearer ${superTok}`);
    expect(link.body.token).toBeTruthy();
    // A fresh address, so the guessing test above has not spent this bucket.
    const done = await request(app).post(`/api/client-onboard/${link.body.token}`).set('X-Forwarded-For', '203.0.113.77')
      .send({ username: 'consentco', password: 'longenough1' });
    expect(done.body.success, JSON.stringify(done.body)).toBe(true);
    const after = await M('ClientAccount').findById(client._id).lean();
    expect(after.privacyNoticeAcceptedAt).toBeTruthy();
    expect(after.privacyNoticeVersion).toBe('2026-11');
  });
});
