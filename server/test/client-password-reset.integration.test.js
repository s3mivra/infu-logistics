// Client-account password reset - passwords are bcrypt-hashed and can never
// be "revealed"; this resets to a fresh one instead, gated behind the caller
// re-entering their OWN password, and returns the new plaintext exactly once.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, superTok, staffTok, clientId;
const auth = (method, path, token) => request(app)[method](path).set('Authorization', `Bearer ${token}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'pwSuper', role: 'superadmin' }); // default password 'pw'
  await makeUser({ name: 'pwStaff', role: 'staff' });
  superTok = await loginStaff(app, 'pwSuper');
  staffTok = await loginStaff(app, 'pwStaff');

  const created = await auth('post', '/api/client-accounts', superTok).send({
    username: 'resetco', password: 'original-secret', name: 'Reset Co',
  });
  clientId = created.body.client._id;
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('client password reset', () => {
  it('rejects a non-superadmin', async () => {
    const res = await auth('post', `/api/client-accounts/${clientId}/reset-password`, staffTok).send({ confirmPassword: 'pw' });
    expect(res.status).toBe(403);
  });

  it('rejects a missing confirmPassword', async () => {
    const res = await auth('post', `/api/client-accounts/${clientId}/reset-password`, superTok).send({});
    expect(res.status).toBe(400);
  });

  it('rejects the wrong own-password', async () => {
    const res = await auth('post', `/api/client-accounts/${clientId}/reset-password`, superTok).send({ confirmPassword: 'not-my-password' });
    expect(res.status).toBe(401);
  });

  it('404s for a non-existent client', async () => {
    const res = await auth('post', `/api/client-accounts/${new mongoose.Types.ObjectId()}/reset-password`, superTok).send({ confirmPassword: 'pw' });
    expect(res.status).toBe(404);
  });

  it('resets the password once confirmed, returns a fresh plaintext, and the old password stops working', async () => {
    const res = await auth('post', `/api/client-accounts/${clientId}/reset-password`, superTok).send({ confirmPassword: 'pw' });
    expect(res.status).toBe(200);
    expect(res.body.newPassword).toBeTruthy();
    expect(res.body.newPassword.length).toBeGreaterThanOrEqual(12);
    expect(res.body.client.username).toBe('resetco');

    const oldLogin = await request(app).post('/api/client-auth/login').send({ username: 'resetco', password: 'original-secret' });
    expect(oldLogin.status).not.toBe(200);

    const newLogin = await request(app).post('/api/client-auth/login').send({ username: 'resetco', password: res.body.newPassword });
    expect(newLogin.status).toBe(200);
  });

  it('never stores the new password in plaintext', async () => {
    const ClientAccount = mongoose.model('ClientAccount');
    const doc = await ClientAccount.findById(clientId).lean();
    expect(doc.password).not.toMatch(/^[A-Za-z0-9]{12}$/); // not the raw generated string
    expect(await bcrypt.compare('some-other-guess', doc.password)).toBe(false);
  });
});
