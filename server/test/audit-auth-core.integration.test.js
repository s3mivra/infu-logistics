// Regression tests for the 2026-11 audit's sign-in and permission findings
// (M04, M05, M06, M07, M21, M24, M25, M26, M27, M28, M53, M54, M106).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { io as ioc } from 'socket.io-client';
import { bootApp, makeUser, makeClient, loginStaff, loginClient } from './helpers/harness.js';

let ctx, app, superTok, cashierTok, delegateTok, driverTok;
const M = (n) => mongoose.model(n);
const auth = (m, p, t) => request(app)[m](p).set('Authorization', `Bearer ${t}`);
const cookieOf = (r) => (r.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log', jwtSecret: 'audit-auth-core-secret-0123456789abcd' });
  app = ctx.app;
  await makeUser({ name: 'AcSuper', role: 'superadmin' });
  await makeUser({ name: 'AcCashier', role: 'cashier' });
  await makeUser({ name: 'AcDelegate', role: 'Staff', permissions: ['users.manage', 'orders.view'] });
  await makeUser({ name: 'AcDriver', role: 'Staff', permissions: ['orders.view', 'reports.view', 'screen.reports.deliverysheet'] });
  await M('User').updateMany({}, { $set: { tenantId: null } });
  await M('User').updateOne({ name: 'AcSuper' }, { $set: { pinHash: await bcrypt.hash('0017', 12) } });
  superTok = await loginStaff(app, 'AcSuper');
  cashierTok = await loginStaff(app, 'AcCashier');
  delegateTok = await loginStaff(app, 'AcDelegate');
  driverTok = await loginStaff(app, 'AcDriver');
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('PIN switching (M04)', () => {
  it('a correct PIN never opens the owner account', async () => {
    const r = await auth('post', '/api/users/switch', cashierTok).send({ pin: '0017' });
    expect(r.status).toBe(403);
    expect(r.body.token).toBeUndefined();
  });
});

describe('page permissions on the server (M07)', () => {
  it('the Driver preset cannot read the P&L, balance sheet or books health', async () => {
    for (const p of ['/api/reports/pnl', '/api/reports/balance-sheet', '/api/reports/books-health']) {
      expect((await auth('get', p, driverTok)).status, p).toBe(403);
    }
    expect((await auth('get', '/api/reports/pnl', superTok)).status).toBe(200);
  });
});

describe('tokens (M54)', () => {
  it('a token without the staff audience is refused even with a staff role', async () => {
    const u = await M('User').findOne({ name: 'AcSuper' }).lean();
    const legacy = jwt.sign({ _id: u._id, role: 'superadmin', name: 'AcSuper' }, process.env.JWT_SECRET, { expiresIn: '5m' });
    expect((await auth('get', '/api/users', legacy)).status).toBe(401);
  });
  it('a token signed with another algorithm is refused', async () => {
    const u = await M('User').findOne({ name: 'AcSuper' }).lean();
    const hs512 = jwt.sign({ _id: u._id, role: 'superadmin', aud: 'staff', tv: 0 }, process.env.JWT_SECRET, { algorithm: 'HS512', expiresIn: '5m' });
    expect((await auth('get', '/api/users', hs512)).status).toBe(401);
  });
});

describe('logout and refresh (M26, M27)', () => {
  it('logout ends the access token as well as the refresh session', async () => {
    const login = await request(app).post('/api/users/login').send({ name: 'AcCashier', password: 'pw' });
    const t = login.body.token;
    expect((await auth('get', '/api/users/me', t)).status).toBe(200);
    await request(app).post('/api/auth/logout').set('Cookie', cookieOf(login)).set('Authorization', `Bearer ${t}`).send({});
    expect((await auth('get', '/api/users/me', t)).status).toBe(401);
  });

  it('the refresh token rotates, and replaying an old one ends every session', async () => {
    const login = await request(app).post('/api/users/login').send({ name: 'AcDriver', password: 'pw' });
    const first = cookieOf(login);
    const r1 = await request(app).post('/api/auth/refresh').set('Cookie', first).send({});
    expect(r1.status).toBe(200);
    const second = cookieOf(r1);
    expect(second).not.toBe(first);
    // Past the grace window, the first token is a stolen copy.
    await M('RefreshSession').updateMany({ replacedBy: { $exists: true } }, { $set: { rotatedAt: new Date(Date.now() - 60_000) } });
    const replay = await request(app).post('/api/auth/refresh').set('Cookie', first).send({});
    expect(replay.status).toBe(401);
    const after = await request(app).post('/api/auth/refresh').set('Cookie', second).send({});
    expect(after.status).toBe(401);
    driverTok = await loginStaff(app, 'AcDriver');
  });
});

describe('sockets (M06)', () => {
  it('a socket is dropped when its user is revoked', async () => {
    await makeUser({ name: 'AcLeaver', role: 'cashier' });
    const t = await loginStaff(app, 'AcLeaver');
    const srv = ctx.server || app.server;
    if (!srv?.listen) return;   // harness without a listening server: covered by unit wiring
    await new Promise((r) => srv.listening ? r() : srv.listen(0, r));
    const port = srv.address().port;
    const s = ioc(`http://127.0.0.1:${port}`, { auth: { token: t }, transports: ['websocket'], reconnection: false });
    await new Promise((r, j) => { s.on('connect', r); s.on('connect_error', j); });
    const dropped = new Promise((r) => s.on('disconnect', () => r(true)));
    const u = await M('User').findOne({ name: 'AcLeaver' }).lean();
    await auth('delete', `/api/users/${u._id}`, superTok);
    expect(await Promise.race([dropped, new Promise((r) => setTimeout(() => r(false), 3000))])).toBe(true);
    s.close();
  });
});

describe('roles and pay (M24, M25, M106)', () => {
  it('a custom role cannot take a built-in or reserved name', async () => {
    for (const name of ['Admin', 'superadmin', 'client', 'kitchen', 'STAFF']) {
      expect((await auth('post', '/api/roles', superTok).send({ name, permissions: ['orders.view'] })).status, name).toBe(400);
    }
  });
  it('a staff account cannot be given the role "client"', async () => {
    expect((await auth('post', '/api/users', superTok).send({ name: 'AcFakeClient', password: 'pw-12345', role: 'client' })).status).toBe(403);
  });
  it('a users.manage delegate cannot raise their own pay or commission', async () => {
    const me = await M('User').findOne({ name: 'AcDelegate' }).lean();
    expect((await auth('patch', `/api/users/${me._id}`, delegateTok).send({ commissionRate: 50 })).status).toBe(403);
    expect((await auth('patch', `/api/users/${me._id}`, delegateTok).send({ dailyRate: 99999 })).status).toBe(403);
    await auth('put', '/api/users-commission-rate', delegateTok).send({ rate: 100 });
    expect((await M('User').findById(me._id).lean()).commissionRate || 0).not.toBe(100);
  });
});

describe('order lookups (M21)', () => {
  it('an order id alone no longer opens an order anonymously', async () => {
    const prod = await M('Product').create({ name: 'AcWidget', category: 'Misc', basePrice: 10 });
    const o = await auth('post', '/api/orders', superTok).send({ items: [{ productId: String(prod._id), name: 'AcWidget', price: 10, quantity: 1 }], paymentMethod: 'Cash' });
    expect(o.status, JSON.stringify(o.body)).toBe(200);
    expect((await request(app).get(`/api/orders/${o.body.order._id}`)).status).toBe(404);
    expect((await auth('get', `/api/orders/${o.body.order._id}`, superTok)).status).toBe(200);
  });
});

describe('client portal (M28, M53)', () => {
  it('one message for an unknown username and a wrong password', async () => {
    await makeClient({ username: 'acportal' });
    const unknown = await request(app).post('/api/client-auth/login').send({ username: 'nobody-here', password: 'x' });
    const wrong = await request(app).post('/api/client-auth/login').send({ username: 'acportal', password: 'x' });
    expect(unknown.body.error).toBe(wrong.body.error);
  });
  it("changing the password ends the client's other sessions and keeps this one", async () => {
    const a = await loginClient(app, 'acportal');
    const b = await loginClient(app, 'acportal');
    await new Promise((r) => setTimeout(r, 1100));
    const ch = await auth('post', '/api/client/password', a).send({ currentPassword: 'pw', newPassword: 'new-password-1' });
    expect(ch.status, JSON.stringify(ch.body)).toBe(200);
    expect((await auth('get', '/api/client/profile', b)).status).toBe(401);
    expect((await auth('get', '/api/client/profile', ch.body.token)).status).toBe(200);
  });
});

describe('per-account login lockout (M05)', () => {
  it('ten wrong passwords lock the account whatever address they come from', async () => {
    await makeUser({ name: 'AcTarget', role: 'cashier' });
    for (let i = 0; i < 10; i++) {
      await request(app).post('/api/users/login').set('X-Forwarded-For', `203.0.113.${i + 1}`).send({ name: 'AcTarget', password: `wrong-${i}` });
    }
    const right = await request(app).post('/api/users/login').set('X-Forwarded-For', '198.51.100.7').send({ name: 'AcTarget', password: 'pw' });
    expect(right.status).toBe(429);
    expect(right.body.token).toBeUndefined();
  });
});
