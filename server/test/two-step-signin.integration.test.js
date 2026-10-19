// Two-step sign-in: turning it on, signing in with it, and every way back in.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';
import { codeAt } from '../lib/totp.js';

let ctx, app, ownerTok, anaTok, secret, backupCodes;
const as = (m, p, t) => request(app)[m](p).set('Authorization', `Bearer ${t}`);
const signIn = (body) => request(app).post('/api/users/login').send(body);
const User = () => mongoose.model('User');

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'twoOwner', role: 'superadmin', password: 'ownerpass1' });
  await makeUser({ name: 'twoAna', role: 'staff', password: 'anapass123', permissions: ['pos.use'] });
  ownerTok = await loginStaff(app, 'twoOwner', 'ownerpass1');
  anaTok = await loginStaff(app, 'twoAna', 'anapass123');
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('turning it on', () => {
  it('is off until the person turns it on, and setup alone changes nothing about signing in', async () => {
    expect((await as('get', '/api/users/me/two-step', anaTok)).body).toMatchObject({ enabled: false });
    const setup = await as('post', '/api/users/me/two-step/setup', anaTok);
    expect(setup.status).toBe(200);
    secret = setup.body.secret;
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    expect((await signIn({ name: 'twoAna', password: 'anapass123' })).body.success).toBe(true);   // still one step
  });

  it('needs the code the app shows, then hands back the backup codes once', async () => {
    expect((await as('post', '/api/users/me/two-step/enable', anaTok).send({ code: '000000' })).status).toBe(400);
    const on = await as('post', '/api/users/me/two-step/enable', anaTok).send({ code: codeAt(secret) });
    expect(on.status).toBe(200);
    backupCodes = on.body.backupCodes;
    expect(backupCodes).toHaveLength(8);
    expect((await as('get', '/api/users/me/two-step', anaTok)).body).toMatchObject({ enabled: true, backupCodesLeft: 8 });
  });

  it('never puts the secret or the backup codes in a list of users', async () => {
    const list = await as('get', '/api/users', ownerTok);
    const raw = JSON.stringify(list.body);
    expect(raw).not.toContain(secret);
    expect(raw).not.toMatch(/totpSecret|totpBackupCodes|totpPending/);
    expect(list.body.users.find(u => u.name === 'twoAna').totpEnabled).toBe(true);   // that it is on is fine to show
  });
});

describe('signing in with it', () => {
  it('asks for the code after a right password, and gives no session without it', async () => {
    const first = await signIn({ name: 'twoAna', password: 'anapass123' });
    // Not an error: asking for the code must not count as a failed attempt.
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ success: false, needsCode: true });
    expect(first.body.token).toBeUndefined();
    expect(first.headers['set-cookie']).toBeUndefined();
  });

  it('a wrong password is just a wrong password - it does not say a code is needed', async () => {
    const res = await signIn({ name: 'twoAna', password: 'not-the-password', code: codeAt(secret) });
    expect(res.status).toBe(401);
    expect(res.body.needsCode).toBeUndefined();
  });

  it('lets in the right code, and refuses a wrong one', async () => {
    expect((await signIn({ name: 'twoAna', password: 'anapass123', code: '123456' })).body).toMatchObject({ success: false, needsCode: true });
    const ok = await signIn({ name: 'twoAna', password: 'anapass123', code: codeAt(secret) });
    expect(ok.body.success).toBe(true);
    expect(ok.body.token).toBeTruthy();
  });

  it('a backup code works once', async () => {
    const code = backupCodes[0];
    expect((await signIn({ name: 'twoAna', password: 'anapass123', code: code.toLowerCase() })).body.success).toBe(true);
    expect((await signIn({ name: 'twoAna', password: 'anapass123', code })).body).toMatchObject({ success: false, needsCode: true });
    expect((await as('get', '/api/users/me/two-step', anaTok)).body.backupCodesLeft).toBe(7);
  });

  it('someone without it signs in exactly as before', async () => {
    expect((await signIn({ name: 'twoOwner', password: 'ownerpass1' })).body.success).toBe(true);
  });
});

describe('the ways back', () => {
  it('turning it off needs the password again', async () => {
    expect((await as('post', '/api/users/me/two-step/disable', anaTok).send({ password: 'wrong' })).status).toBe(401);
    expect((await as('get', '/api/users/me/two-step', anaTok)).body.enabled).toBe(true);
  });

  it('only the owner can switch it off for someone else, with their own password', async () => {
    const ana = await User().findOne({ name: /^twoana$/i }).lean();
    expect((await as('post', `/api/users/${ana._id}/two-step/reset`, anaTok).send({ confirmPassword: 'anapass123' })).status).toBe(403);
    expect((await as('post', `/api/users/${ana._id}/two-step/reset`, ownerTok).send({ confirmPassword: 'wrong' })).status).toBe(401);
    expect((await as('post', `/api/users/${ana._id}/two-step/reset`, ownerTok).send({ confirmPassword: 'ownerpass1' })).status).toBe(200);
    // Back to one step, and the old secret is gone.
    expect((await signIn({ name: 'twoAna', password: 'anapass123' })).body.success).toBe(true);
    const after = await User().findById(ana._id).select('+totpSecret +totpBackupCodes').lean();
    expect(after).toMatchObject({ totpEnabled: false, totpSecret: '', totpBackupCodes: [] });
  });

  it('is written to the audit trail', async () => {
    const actions = (await mongoose.model('AuditLog').find({ action: /two-step/i }).lean()).map(a => a.action);
    expect(actions.some(a => /enabled/i.test(a))).toBe(true);
    expect(actions.some(a => /disabled/i.test(a))).toBe(true);
    expect(actions.some(a => /backup/i.test(a))).toBe(true);
  });
});
