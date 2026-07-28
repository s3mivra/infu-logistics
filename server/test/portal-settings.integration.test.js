// The client portal is served to clients, not staff, so it reads its copy and
// branding from an UNAUTHENTICATED route. These tests pin the security boundary:
// portal* keys are readable without a token, everything else is not, and writing
// still requires a staff token with settings.manage.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let app, stop, superT;

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'log', jwtSecret: 'portal-set-secret-0123456789' }));
  await makeUser({ name: 'PortalBoss', role: 'superadmin', password: 'pw' });
  await mongoose.model('User').updateMany({}, { $set: { tenantId: null } });
  superT = await loginStaff(app, 'PortalBoss', 'pw');
}, 120000);

afterAll(async () => { await stop(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });

describe('GET /api/public/portal-settings', () => {
  it('is readable with no token at all', async () => {
    const res = await request(app).get('/api/public/portal-settings');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.settings).toBeTypeOf('object');
  });

  it('returns portal keys written by an admin', async () => {
    await request(app).patch('/api/settings/portalWelcomeTitle')
      .set(auth(superT)).send({ value: 'Welcome back' }).expect(200);
    await request(app).patch('/api/settings/portalShowPrices')
      .set(auth(superT)).send({ value: true }).expect(200);

    const res = await request(app).get('/api/public/portal-settings');
    expect(res.body.settings.portalWelcomeTitle).toBe('Welcome back');
    expect(res.body.settings.portalShowPrices).toBe(true);
  });

  it('never leaks non-portal settings', async () => {
    // Operational settings live in the same collection — the whitelist is the
    // only thing keeping them off a public route.
    await request(app).patch('/api/settings/globalCreditLimit')
      .set(auth(superT)).send({ value: 50000 }).expect(200);
    await request(app).patch('/api/settings/creditLimitMode')
      .set(auth(superT)).send({ value: 'global' }).expect(200);

    const res = await request(app).get('/api/public/portal-settings');
    expect(res.body.settings).not.toHaveProperty('globalCreditLimit');
    expect(res.body.settings).not.toHaveProperty('creditLimitMode');
  });

  it('does not make the authenticated settings route public', async () => {
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(401);
  });

  it('still requires a staff token to write a portal setting', async () => {
    const res = await request(app).patch('/api/settings/portalAnnouncement').send({ value: 'hax' });
    expect(res.status).toBe(401);
  });
});
