// Clients manage their own login and portal appearance. These routes are the
// only ones a client token may use to WRITE to its own account, so the tests pin
// both the happy path and the boundary: a client must never be able to reach
// another account, escalate a session into a takeover, or set a bogus theme.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, makeClient, loginStaff, loginClient } from './helpers/harness.js';

let app, stop, clientTok, otherTok;

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'log', jwtSecret: 'client-self-secret-0123456789' }));
  await makeUser({ name: 'SelfBoss', role: 'superadmin', password: 'pw' });
  await makeClient({ username: 'selfclient', password: 'pw' });
  await makeClient({ username: 'otherclient', password: 'pw' });
  await mongoose.model('User').updateMany({}, { $set: { tenantId: null } });
  await loginStaff(app, 'SelfBoss', 'pw');
  clientTok = await loginClient(app, 'selfclient', 'pw');
  otherTok = await loginClient(app, 'otherclient', 'pw');
}, 120000);

afterAll(async () => { await stop(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });

describe('GET /api/client/profile', () => {
  it('returns the caller\'s own account only', async () => {
    const res = await request(app).get('/api/client/profile').set(auth(clientTok));
    expect(res.status).toBe(200);
    expect(res.body.profile.username).toBe('selfclient');
    expect(res.body.profile.theme).toBeNull();
    // Never leak the hash.
    expect(res.body.profile.password).toBeUndefined();
  });

  it('rejects an anonymous caller', async () => {
    expect((await request(app).get('/api/client/profile')).status).toBe(401);
  });
});

describe('PATCH /api/client/profile - theme', () => {
  it('stores a valid theme on the account', async () => {
    const res = await request(app).patch('/api/client/profile').set(auth(clientTok)).send({ theme: 'ocean' });
    expect(res.status).toBe(200);
    expect(res.body.profile.theme).toBe('ocean');
  });

  it('surfaces the theme on the next login, so it follows the client across devices', async () => {
    const r = await request(app).post('/api/client-auth/login').send({ username: 'selfclient', password: 'pw' });
    expect(r.body.client.theme).toBe('ocean');
  });

  it('refuses an unknown theme', async () => {
    const res = await request(app).patch('/api/client/profile').set(auth(clientTok)).send({ theme: 'neon' });
    expect(res.status).toBe(400);
  });

  it('accepts null to fall back to the shipped default', async () => {
    const res = await request(app).patch('/api/client/profile').set(auth(clientTok)).send({ theme: null });
    expect(res.body.profile.theme).toBeNull();
    await request(app).patch('/api/client/profile').set(auth(clientTok)).send({ theme: 'ocean' });
  });

  it('does not touch another client\'s theme', async () => {
    const other = await request(app).get('/api/client/profile').set(auth(otherTok));
    expect(other.body.profile.theme).toBeNull();
  });
});

describe('PATCH /api/client/profile - username', () => {
  it('renames the account and the new name can sign in', async () => {
    const res = await request(app).patch('/api/client/profile').set(auth(clientTok)).send({ username: 'renamed' });
    expect(res.status).toBe(200);
    expect(res.body.profile.username).toBe('renamed');

    const ok = await request(app).post('/api/client-auth/login').send({ username: 'renamed', password: 'pw' });
    expect(ok.body.success).toBe(true);
    const gone = await request(app).post('/api/client-auth/login').send({ username: 'selfclient', password: 'pw' });
    expect(gone.body.success).toBeFalsy();
  });

  it('refuses a name another client already holds, case-insensitively', async () => {
    const res = await request(app).patch('/api/client/profile').set(auth(clientTok)).send({ username: 'OtherClient' });
    expect(res.status).toBe(409);
  });

  it('refuses illegal characters and lengths', async () => {
    for (const bad of ['bad name', 'ab', 'has/slash', 'x'.repeat(41)]) {
      const res = await request(app).patch('/api/client/profile').set(auth(clientTok)).send({ username: bad });
      expect(res.status).toBe(400);
    }
  });

  it('ignores an _id in the body - scope comes from the token', async () => {
    const otherId = String((await mongoose.model('ClientAccount').findOne({ username: 'otherclient' }).lean())._id);
    // Sends the CALLER's current username so the only thing under test is
    // whether the _id redirects the write. A different name here would rename
    // the caller as a side effect and break the tests that follow.
    const res = await request(app).patch('/api/client/profile').set(auth(clientTok))
      .send({ _id: otherId, username: 'renamed' });
    expect(res.status).toBe(200);
    expect(res.body.profile.username).toBe('renamed');
    const other = await mongoose.model('ClientAccount').findById(otherId).lean();
    expect(other.username).toBe('otherclient');
  });
});

describe('POST /api/client/password', () => {
  it('requires the current password, so a stolen token cannot take over the account', async () => {
    const res = await request(app).post('/api/client/password').set(auth(clientTok))
      .send({ currentPassword: 'wrong', newPassword: 'a-fresh-password' });
    expect(res.status).toBe(401);
  });

  it('enforces a minimum length', async () => {
    const res = await request(app).post('/api/client/password').set(auth(clientTok))
      .send({ currentPassword: 'pw', newPassword: 'short' });
    expect(res.status).toBe(400);
  });

  it('refuses reusing the same password', async () => {
    const res = await request(app).post('/api/client/password').set(auth(clientTok))
      .send({ currentPassword: 'pw', newPassword: 'pw' });
    expect(res.status).toBe(400);
  });

  it('changes it, and only the new one works afterwards', async () => {
    const res = await request(app).post('/api/client/password').set(auth(clientTok))
      .send({ currentPassword: 'pw', newPassword: 'a-fresh-password' });
    expect(res.status).toBe(200);

    const ok = await request(app).post('/api/client-auth/login').send({ username: 'renamed', password: 'a-fresh-password' });
    expect(ok.body.success).toBe(true);
    const old = await request(app).post('/api/client-auth/login').send({ username: 'renamed', password: 'pw' });
    expect(old.body.success).toBeFalsy();
  });

  it('rejects an anonymous caller', async () => {
    const res = await request(app).post('/api/client/password')
      .send({ currentPassword: 'pw', newPassword: 'whatever-long' });
    expect(res.status).toBe(401);
  });
});

describe('staff tokens cannot use the client self-service routes', () => {
  it('refuses a staff token', async () => {
    const staffTok = await loginStaff(app, 'SelfBoss', 'pw');
    const res = await request(app).get('/api/client/profile').set(auth(staffTok));
    expect([401, 403]).toContain(res.status);
  });
});
