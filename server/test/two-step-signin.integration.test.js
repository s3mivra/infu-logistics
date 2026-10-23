// Two-step sign-in: turning it on, signing in with it, and every way back in.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';
import { codeAt } from '../lib/totp.js';

let ctx, app, ownerTok, anaTok, staffTok, secret, backupCodes;
const as = (m, p, t) => request(app)[m](p).set('Authorization', `Bearer ${t}`);
const signIn = (body) => request(app).post('/api/users/login').send(body);
const User = () => mongoose.model('User');

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'twoOwner', role: 'superadmin', password: 'ownerpass1' });
  await makeUser({ name: 'twoAna', role: 'Owner', password: 'anapass123', permissions: ['pos.use'] });
  await makeUser({ name: 'twoStaff', role: 'staff', password: 'staffpass1', permissions: ['pos.use'] });
  ownerTok = await loginStaff(app, 'twoOwner', 'ownerpass1');
  anaTok = await loginStaff(app, 'twoAna', 'anapass123');
  staffTok = await loginStaff(app, 'twoStaff', 'staffpass1');
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('turning it on', () => {
  it('is for Owner accounts only', async () => {
    expect((await as('get', '/api/users/me/two-step', staffTok)).body).toMatchObject({ enabled: false, allowed: false });
    expect((await as('post', '/api/users/me/two-step/setup', staffTok)).status).toBe(403);
    expect((await as('get', '/api/users/me/two-step', anaTok)).body).toMatchObject({ allowed: true, trustDays: 30 });
  });

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

// A device that passed the code is remembered for 30 days; supertest has no
// cookie jar, so each request below carries exactly the cookie it names.
describe('remembered devices', () => {
  let user, cookie;
  const codeSignIn = () => signIn({ name: 'twoAna', password: 'anapass123', code: codeAt(secret) });
  const deviceCookie = (res) => (res.headers['set-cookie'] || []).find(c => c.startsWith(`semivra_td_${user._id}=`))?.split(';')[0];
  const withCookie = (c) => request(app).post('/api/users/login').set('Cookie', c).send({ name: 'twoAna', password: 'anapass123' });

  beforeAll(async () => {
    // Back on, for the Owner account (the ways-back tests turned it off).
    await User().updateOne({ name: 'twoAna' }, { $set: { totpEnabled: false, totpSecret: '', totpBackupCodes: [], trustedDevices: [] } });
    const setup = await as('post', '/api/users/me/two-step/setup', anaTok);
    secret = setup.body.secret;
    expect((await as('post', '/api/users/me/two-step/enable', anaTok).send({ code: codeAt(secret) })).status).toBe(200);
    user = await User().findOne({ name: 'twoAna' }).lean();
  });

  it('a right code trusts the device: the next sign-in there needs only the password', async () => {
    const r = await codeSignIn();
    expect(r.body.success).toBe(true);
    cookie = deviceCookie(r);
    expect(cookie).toBeTruthy();
    expect((r.headers['set-cookie'] || []).find(c => c.startsWith(cookie)).toLowerCase()).toContain('httponly');
    const again = await withCookie(cookie);
    expect(again.body.success, JSON.stringify(again.body)).toBe(true);
    expect(again.body.token).toBeTruthy();
  });

  it('a new device - no cookie, or a made-up one - is asked for the code', async () => {
    expect((await signIn({ name: 'twoAna', password: 'anapass123' })).body.needsCode).toBe(true);
    expect((await withCookie(`semivra_td_${user._id}=made-up-token`)).body.needsCode).toBe(true);
  });

  it('is never a way past a wrong password', async () => {
    const r = await request(app).post('/api/users/login').set('Cookie', cookie).send({ name: 'twoAna', password: 'wrong-pass' });
    expect(r.status).toBe(401);
    expect(r.body.success).toBe(false);
  });

  it('keeps only a hash of the device token, and shows the device in the list', async () => {
    const raw = cookie.split('=')[1];
    const stored = (await User().findById(user._id).select('+trustedDevices').lean()).trustedDevices;
    expect(JSON.stringify(stored)).not.toContain(raw);
    const st = await request(app).get('/api/users/me/two-step').set('Authorization', `Bearer ${anaTok}`).set('Cookie', cookie);
    expect(st.body.trustedDevices.some(d => d.thisDevice)).toBe(true);
  });

  it('asks again once the 30 days are up', async () => {
    await User().updateOne({ _id: user._id }, { $set: { 'trustedDevices.$[].expiresAt': new Date(Date.now() - 1000) } });
    expect((await withCookie(cookie)).body.needsCode).toBe(true);
  });

  it('"Forget all devices" and a password change both make every device ask again', async () => {
    cookie = deviceCookie(await codeSignIn());
    expect((await withCookie(cookie)).body.success).toBe(true);
    expect((await as('post', '/api/users/me/two-step/forget-devices', anaTok)).status).toBe(200);
    expect((await withCookie(cookie)).body.needsCode).toBe(true);

    cookie = deviceCookie(await codeSignIn());
    const tok = (await codeSignIn()).body.token;
    expect((await as('patch', '/api/users/me/password', tok).send({ currentPassword: 'anapass123', newPassword: 'anapass456' })).status).toBe(200);
    const r = await request(app).post('/api/users/login').set('Cookie', cookie).send({ name: 'twoAna', password: 'anapass456' });
    expect(r.body.needsCode).toBe(true);
  });
});
