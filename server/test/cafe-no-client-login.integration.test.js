// A cafe has no client sign-in: its only online ordering is the table QR.
// Client records (a name to bill, a balance) are still kept; what does not
// exist is everything about a client LOGGING IN - and that has to be true on
// the server, not just hidden on the screens.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff, makeClient } from './helpers/harness.js';

let ctx, app, tok;
const as = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'cafeOwner', role: 'superadmin', password: 'ownerpass1' });
  tok = await loginStaff(app, 'cafeOwner', 'ownerpass1');
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('a cafe', () => {
  it('still keeps customers to bill - with no sign-in link made for them', async () => {
    const res = await as('post', '/api/client-accounts').send({ name: 'Office Upstairs' });
    expect(res.status).toBe(200);
    expect(res.body.onboardingPath).toBeUndefined();
    const saved = await mongoose.model('ClientAccount').findById(res.body.client._id).lean();
    expect(saved.onboardingToken).toBeFalsy();
    expect((await as('get', '/api/client-accounts')).body.clients.some(c => c.name === 'OFFICE UPSTAIRS' || c.name === 'Office Upstairs')).toBe(true);
  });

  it('has no client sign-in, even for an account with a real password', async () => {
    await makeClient({ username: 'cafeclient', password: 'secret123' });
    const res = await request(app).post('/api/client-auth/login').send({ username: 'cafeclient', password: 'secret123' });
    expect(res.status).toBe(404);
    expect(res.body.token).toBeUndefined();
  });

  it('has no invitation, onboarding or client password reset', async () => {
    const c = await mongoose.model('ClientAccount').findOne({}).lean();
    expect((await as('post', '/api/client-accounts/invite').send({ name: 'Someone' })).status).toBe(404);
    expect((await as('get', '/api/client-accounts/links')).status).toBe(404);
    expect((await as('post', `/api/client-accounts/${c._id}/onboard-link`).send({})).status).toBe(404);
    expect((await as('post', `/api/client-accounts/${c._id}/reset-password`).send({ confirmPassword: 'ownerpass1' })).status).toBe(404);
    expect((await request(app).get('/api/client-onboard/anything')).status).toBe(404);
    expect((await request(app).post('/api/client-onboard/anything').send({ username: 'abc', password: 'longenough1' })).status).toBe(404);
  });
});
