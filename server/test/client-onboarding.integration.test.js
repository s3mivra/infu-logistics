// Self-service onboarding link (#10): from the Command Center, a superadmin
// generates a one-time link for an auto-promoted (source:'pos') client - the
// client opens it with no auth at all and sets their own login.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let app, stop, superToken;
const auth = (t) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'log', jwtSecret: 'onboard-test-secret-0123456789' }));
  await makeUser({ name: 'OnboardBoss', role: 'superadmin', password: 'pw' });
  await mongoose.model('User').updateMany({}, { $set: { tenantId: null } });
  superToken = await loginStaff(app, 'OnboardBoss', 'pw');
}, 120000);

afterAll(async () => { await stop(); });

describe('client self-service onboarding', () => {
  it('full flow: generate link -> public GET prefill -> public POST completes it', async () => {
    const ClientAccount = mongoose.model('ClientAccount');
    const client = await ClientAccount.create({
      clientCode: 'CUS-1000-A0099', username: `_pos_onboardtest`, password: 'x',
      name: 'Auto Promoted Client', source: 'pos', isActive: true,
    });

    const linkRes = await request(app).post(`/api/client-accounts/${client._id}/onboard-link`).set(auth(superToken));
    expect(linkRes.body.success).toBe(true);
    const token = linkRes.body.token;
    expect(token).toBeTruthy();

    // Public GET - no auth header at all.
    const getRes = await request(app).get(`/api/client-onboard/${token}`);
    expect(getRes.body.success).toBe(true);
    expect(getRes.body.client.name).toBe('Auto Promoted Client');

    // Public POST - sets their own login.
    const postRes = await request(app).post(`/api/client-onboard/${token}`).send({
      name: 'Auto Promoted Client', phone: '09171234567', email: 'client@example.com',
      username: 'realusername', password: 'realpassword123',
    });
    expect(postRes.body.success).toBe(true);

    const fresh = await ClientAccount.findById(client._id).lean();
    expect(fresh.username).toBe('realusername');
    expect(fresh.source).toBe('portal'); // now has a real, usable login
    expect(fresh.onboardingToken).toBeNull();
    expect(fresh.phone).toBe('09171234567');

    // Login with the newly-set credentials works.
    const loginRes = await request(app).post('/api/client-auth/login').send({ username: 'realusername', password: 'realpassword123' });
    expect(loginRes.body.success).toBe(true);
  });

  it('rejects an unknown/expired token', async () => {
    const res = await request(app).get('/api/client-onboard/not-a-real-token');
    expect(res.status).toBe(404);
  });

  it('the token is single-use - a second completion attempt fails', async () => {
    const ClientAccount = mongoose.model('ClientAccount');
    const client = await ClientAccount.create({
      clientCode: 'CUS-1000-A0098', username: `_pos_onboardtest2`, password: 'x',
      name: 'Another Client', source: 'pos', isActive: true,
    });
    const linkRes = await request(app).post(`/api/client-accounts/${client._id}/onboard-link`).set(auth(superToken));
    const token = linkRes.body.token;

    const first = await request(app).post(`/api/client-onboard/${token}`).send({ username: 'firstuser', password: 'password123' });
    expect(first.body.success).toBe(true);

    const second = await request(app).post(`/api/client-onboard/${token}`).send({ username: 'seconduser', password: 'password123' });
    expect(second.status).toBe(404); // token already cleared
  });

  it('rejects a duplicate username', async () => {
    const ClientAccount = mongoose.model('ClientAccount');
    const client = await ClientAccount.create({
      clientCode: 'CUS-1000-A0097', username: `_pos_onboardtest3`, password: 'x',
      name: 'Third Client', source: 'pos', isActive: true,
    });
    const linkRes = await request(app).post(`/api/client-accounts/${client._id}/onboard-link`).set(auth(superToken));
    const token = linkRes.body.token;
    const res = await request(app).post(`/api/client-onboard/${token}`).send({ username: 'realusername', password: 'password123' });
    expect(res.status).toBe(409);
  });
});
