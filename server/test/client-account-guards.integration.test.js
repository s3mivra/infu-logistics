// Who may change what on a client account, and when a client session stops.
//
//  - clients.edit is for everyday details. The login, the credit line and the
//    price tier each keep their own guard.
//  - A client session is only as good as the account behind it: switched off,
//    or its password reset, and the session ends there - not 8 hours later.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, superTok, editorTok, approverTok, client;
const as = (m, p, t) => request(app)[m](p).set('Authorization', `Bearer ${t}`);
const Client = () => mongoose.model('ClientAccount');
const clientLogin = async (username, password) => (await request(app).post('/api/client-auth/login').send({ username, password })).body.token;

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'guardOwner', role: 'superadmin', password: 'ownerpass1' });
  await makeUser({ name: 'guardEditor', role: 'staff', permissions: ['clients.view', 'clients.edit'] });
  await makeUser({ name: 'guardApprover', role: 'staff', permissions: ['clients.view', 'clients.edit', 'pricing.approve', 'pricing.tiers'] });
  superTok = await loginStaff(app, 'guardOwner', 'ownerpass1');
  editorTok = await loginStaff(app, 'guardEditor');
  approverTok = await loginStaff(app, 'guardApprover');
  const res = await as('post', '/api/client-accounts', superTok).send({
    username: 'guardco', password: 'secret123', name: 'Guard Co', paymentMethod: 'On Account', creditLimit: 1000,
  });
  expect(res.status).toBe(200);
  client = res.body.client;
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('editing a client with clients.edit', () => {
  it('changes everyday details', async () => {
    const res = await as('patch', `/api/client-accounts/${client._id}`, editorTok).send({ phone: '0917 000 0000', contactNotes: 'Ask for Ana' });
    expect(res.status).toBe(200);
    expect(res.body.client.contactNotes).toBe('Ask for Ana');
  });

  it('cannot set the password or the username - that would be signing in as the client', async () => {
    const before = (await Client().findById(client._id).lean()).password;
    for (const body of [{ password: 'takeover123' }, { username: 'mine-now' }]) {
      const res = await as('patch', `/api/client-accounts/${client._id}`, editorTok).send(body);
      expect(res.status, JSON.stringify(body)).toBe(403);
    }
    const after = await Client().findById(client._id).lean();
    expect(after.password).toBe(before);
    expect(after.username).toBe('guardco');
  });

  it('cannot change the credit line past its approval', async () => {
    for (const body of [{ creditLimit: 999999 }, { creditTermsDays: 120 }]) {
      const res = await as('patch', `/api/client-accounts/${client._id}`, editorTok).send(body);
      expect(res.status, JSON.stringify(body)).toBe(403);
      expect(res.body.error).toMatch(/credit request/);
    }
    expect((await Client().findById(client._id).lean()).creditLimit).toBe(1000);
  });

  it('cannot move the client to another price tier', async () => {
    const res = await as('patch', `/api/client-accounts/${client._id}`, editorTok).send({ segments: ['Dealer'] });
    expect(res.status).toBe(403);
  });

  it('an approver can change the terms and the tier, and the owner anything', async () => {
    expect((await as('patch', `/api/client-accounts/${client._id}`, approverTok).send({ creditTermsDays: 45, segments: ['Dealer'] })).status).toBe(200);
    expect((await as('patch', `/api/client-accounts/${client._id}`, approverTok).send({ password: 'takeover123' })).status).toBe(403);
    expect((await as('patch', `/api/client-accounts/${client._id}`, superTok).send({ creditLimit: 2000 })).status).toBe(200);
    expect((await Client().findById(client._id).lean()).creditLimit).toBe(2000);
  });

  it('answers not found for an id that is not one', async () => {
    expect((await as('patch', '/api/client-accounts/not-an-id', superTok).send({ phone: '1' })).status).toBe(404);
  });
});

describe('a client session', () => {
  it('works while the account is active, and stops the moment it is switched off', async () => {
    const tok = await clientLogin('guardco', 'secret123');
    expect((await as('get', '/api/client/profile', tok)).status).toBe(200);

    await as('patch', `/api/client-accounts/${client._id}`, superTok).send({ isActive: false });
    expect((await as('get', '/api/client/profile', tok)).status).toBe(401);
    // ...including for placing an order, which is what switching off is for.
    const order = await as('post', '/api/orders', tok).send({ table: 'Takeout', items: [{ name: 'X', price: 1, quantity: 1 }] });
    expect(order.status).toBe(401);

    await as('patch', `/api/client-accounts/${client._id}`, superTok).send({ isActive: true });
    expect((await as('get', '/api/client/profile', tok)).status).toBe(200);
  });

  it('from before a password reset is ended by it; the new password signs in', async () => {
    const old = await clientLogin('guardco', 'secret123');
    // Sessions are dated to the second; let the clock move past this one.
    await new Promise(r => setTimeout(r, 2100));
    const reset = await as('post', `/api/client-accounts/${client._id}/reset-password`, superTok).send({ confirmPassword: 'ownerpass1' });
    expect(reset.status).toBe(200);

    expect((await as('get', '/api/client/profile', old)).status).toBe(401);
    const fresh = await clientLogin('guardco', reset.body.newPassword);
    expect((await as('get', '/api/client/profile', fresh)).status).toBe(200);
  });

  it('for an account that no longer exists is refused', async () => {
    const gone = await as('post', '/api/client-accounts', superTok).send({ username: 'goneco', password: 'secret123', name: 'Gone Co' });
    const tok = await clientLogin('goneco', 'secret123');
    await Client().deleteOne({ _id: gone.body.client._id });
    expect((await as('get', '/api/client/profile', tok)).status).toBe(401);
  });
});

describe('choosing a login from an onboarding link', () => {
  const invite = async (name) => (await as('post', '/api/client-accounts/invite', superTok).send({ name })).body.client.onboardingPath.split('/').pop();
  const redeem = (token, body) => request(app).post(`/api/client-onboard/${token}`).send(body);

  it('needs a password of 8, and a username the login box can take', async () => {
    const token = await invite('Onboard Rules Co');
    expect((await redeem(token, { username: 'rulesco', password: 'short1' })).status).toBe(400);
    for (const username of ['ab', '_pending_x', 'has space', 'a'.repeat(41)]) {
      expect((await redeem(token, { username, password: 'longenough1' })).status, username).toBe(400);
    }
    expect((await redeem(token, { username: 'Rules.Co-1', password: 'longenough1' })).status).toBe(200);
  });

  it('refuses a username already taken, whatever its case', async () => {
    // An account from before usernames were lowercased.
    await Client().updateOne({ _id: client._id }, { $set: { username: 'GuardCo' } });
    const token = await invite('Onboard Clash Co');
    const res = await redeem(token, { username: 'guardco', password: 'longenough1' });
    expect(res.status).toBe(409);
    await Client().updateOne({ _id: client._id }, { $set: { username: 'guardco' } });
  });
});
