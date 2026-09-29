// Client links for the office: copy, never create. An onboarding link sets the
// client's own username and password, so issuing one stays superadmin-only;
// staff holding clients.links only see the ones already issued and still valid.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, fresh, onboarded, lapsed;
const tok = {};
const as = (t, m, p) => request(app)[m](p).set('Authorization', `Bearer ${t}`);
const M = (n) => mongoose.model(n);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'clOwner', role: 'superadmin' });
  await makeUser({ name: 'clOffice', role: 'staff', permissions: ['orders.view', 'clients.links'] });
  await makeUser({ name: 'clCashier', role: 'staff', permissions: ['orders.view', 'pos.use'] });
  tok.owner = await loginStaff(app, 'clOwner');
  tok.office = await loginStaff(app, 'clOffice');
  tok.cashier = await loginStaff(app, 'clCashier');
  fresh = await M('ClientAccount').create({ name: 'Reyes Hardware', clientCode: 'CL-1', username: '_pending_cl-1', password: 'x' });
  onboarded = await M('ClientAccount').create({ name: 'Kasa Lokal', clientCode: 'CL-2', username: 'kasalokal', password: 'x' });
  lapsed = await M('ClientAccount').create({ name: 'Old Link Co', clientCode: 'CL-3', username: '_pos_cl-3', password: 'x', onboardingToken: 'expired-token', onboardingTokenExpiresAt: new Date(Date.now() - 1000) });
}, 120000);
afterAll(async () => { await ctx.stop(); });

describe('client links', () => {
  it('shows an onboarding link an admin issued, while it is valid', async () => {
    const issued = await as(tok.owner, 'post', `/api/client-accounts/${fresh._id}/onboard-link`);
    expect(issued.status).toBe(200);
    const r = await as(tok.office, 'get', '/api/client-accounts/links');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.signInPath).toBe('/client-login');
    const row = r.body.clients.find(c => c.name === 'Reyes Hardware');
    expect(row.onboardingPath).toBe(`/client-onboard/${issued.body.token}`);
    expect(row.hasLogin).toBe(false);
  });

  it('never shows an expired link, and marks a client who already has a login', async () => {
    const r = await as(tok.office, 'get', '/api/client-accounts/links');
    expect(r.body.clients.find(c => c.name === 'Old Link Co').onboardingPath).toBeNull();
    expect(r.body.clients.find(c => c.name === 'Kasa Lokal')).toMatchObject({ hasLogin: true, onboardingPath: null });
  });

  it('reading the links changes nothing', async () => {
    const before = await M('ClientAccount').findById(fresh._id).lean();
    await as(tok.office, 'get', '/api/client-accounts/links');
    const after = await M('ClientAccount').findById(fresh._id).lean();
    expect(after.onboardingToken).toBe(before.onboardingToken);
    expect(String(after.onboardingTokenExpiresAt)).toBe(String(before.onboardingTokenExpiresAt));
  });

  it('office staff can copy but not issue a link', async () => {
    const r = await as(tok.office, 'post', `/api/client-accounts/${onboarded._id}/onboard-link`);
    expect(r.status).toBe(403);
    expect((await M('ClientAccount').findById(onboarded._id).lean()).onboardingToken).toBeFalsy();
  });

  it('without the permission, no links at all', async () => {
    expect((await as(tok.cashier, 'get', '/api/client-accounts/links')).status).toBe(403);
  });
});
