// "Just QR": the ordering code from the login screen, with nobody signed in.
//
// A code is a live ordering session, and the login page is reachable from the
// internet, so only a device a manager turned on can make one - by the long
// random key it was given, which the server keeps only as a hash.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, bossTok, staffTok;
const as = (tok) => (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const device = (key) => (m, p) => request(app)[m](p).set('x-qr-device', key);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'QrBoss', role: 'superadmin' });
  await makeUser({ name: 'QrStaff', role: 'staff' });
  bossTok = await loginStaff(app, 'QrBoss');
  staffTok = await loginStaff(app, 'QrStaff');
}, 120000);
afterAll(async () => { await ctx.stop(); });

describe('turning a device on', () => {
  it('needs settings.manage', async () => {
    expect((await as(staffTok)('post', '/api/qr-devices').send({ label: 'Mine' })).status).toBe(403);
  });

  it('returns a key once, and keeps only its hash', async () => {
    const res = await as(bossTok)('post', '/api/qr-devices').send({ label: 'Counter tablet' });
    expect(res.body.success).toBe(true);
    expect(res.body.key).toMatch(/^[0-9a-f]{64}$/);
    const stored = await mongoose.model('QrDevice').findById(res.body.device._id).lean();
    expect(stored.keyHash).not.toBe(res.body.key);
    const list = await as(bossTok)('get', '/api/qr-devices');
    expect(JSON.stringify(list.body)).not.toContain(res.body.key);
  });
});

describe('showing the code', () => {
  let key, id;
  beforeAll(async () => {
    const res = await as(bossTok)('post', '/api/qr-devices').send({ label: 'Front' });
    key = res.body.key; id = res.body.device._id;
  });

  it('an enabled device gets a live ordering session', async () => {
    expect((await device(key)('get', '/api/qr-devices/me')).body.enabled).toBe(true);
    const res = await device(key)('post', '/api/qr-devices/session');
    expect(res.status).toBe(200);
    expect(res.body.table).toMatch(/^QR-/);
    const status = await device(key)('get', `/api/qr-devices/session/${res.body.sessionId}`);
    expect(status.body).toMatchObject({ claimed: false, expired: false });
  });

  it('cannot be asked for codes faster than a person would', async () => {
    const res = await device(key)('post', '/api/qr-devices/session');
    expect(res.status).toBe(429);
  });

  it('refuses a device without a key, or with a wrong one', async () => {
    expect((await request(app).post('/api/qr-devices/session')).status).toBe(403);
    expect((await device('f'.repeat(64))('post', '/api/qr-devices/session')).status).toBe(403);
  });

  it('stops the moment the device is switched off', async () => {
    expect((await as(bossTok)('delete', `/api/qr-devices/${id}`)).body.success).toBe(true);
    expect((await device(key)('get', '/api/qr-devices/me')).body.enabled).toBe(false);
    expect((await device(key)('post', '/api/qr-devices/session')).status).toBe(403);
  });
});

describe('a scanned code, after the tablet has moved on to the next one', () => {
  it('still takes the order of whoever scanned it; only the unscanned code is retired', async () => {
    const { body: dev } = await as(bossTok)('post', '/api/qr-devices').send({ label: 'Door' });
    const latte = await mongoose.model('Product').create({ name: 'QR Latte', category: 'Coffee', basePrice: 130 });

    // The customer scans the code on screen...
    const first = (await device(dev.key)('post', '/api/qr-devices/session')).body;
    expect((await request(app).post(`/api/sessions/${first.sessionId}/claim`)).body.success).toBe(true);

    // ...the tablet sees it was scanned and shows a new one for the next
    // person (after the minimum gap between codes)...
    await new Promise((r) => setTimeout(r, 4100));
    const second = (await device(dev.key)('post', '/api/qr-devices/session')).body;
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(second.table).toBe(first.table);

    // ...and the first customer sends their order on the code they scanned.
    const order = await request(app).post('/api/orders').send({
      table: first.table, sessionId: first.sessionId, customerName: 'Scanner',
      items: [{ productId: String(latte._id), name: 'QR Latte', price: 130, quantity: 1 }],
    });
    expect(order.body.error).toBeUndefined();
    expect(order.body.success).toBe(true);

    // The next code, never scanned, is the one a later refresh retires.
    await new Promise((r) => setTimeout(r, 4100));
    await device(dev.key)('post', '/api/qr-devices/session');
    const status = await device(dev.key)('get', `/api/qr-devices/session/${second.sessionId}`);
    expect(status.body.expired).toBe(true);
  }, 20000);
});

describe('turning a device on from the Just QR screen', () => {
  it('works with a manager name and password, and leaves nobody signed in', async () => {
    const res = await request(app).post('/api/qr-devices/enable-here')
      .send({ name: 'QrBoss', password: 'pw', label: 'Front counter' });
    expect(res.status).toBe(200);
    expect(res.body.key).toMatch(/^[0-9a-f]{64}$/);
    // No session cookie: the tablet is not signed in as the manager afterwards.
    expect(String(res.headers['set-cookie'] || '')).not.toMatch(/refresh/i);
    const qr = await device(res.body.key)('post', '/api/qr-devices/session');
    expect(qr.status).toBe(200);
  });

  it('refuses a wrong password', async () => {
    const res = await request(app).post('/api/qr-devices/enable-here').send({ name: 'QrBoss', password: 'nope' });
    expect(res.status).toBe(401);
  });

  it('refuses someone who cannot change system settings', async () => {
    const res = await request(app).post('/api/qr-devices/enable-here').send({ name: 'QrStaff', password: 'pw' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/cannot turn devices on/);
  });

  it('refuses a probe that sends objects instead of text', async () => {
    const res = await request(app).post('/api/qr-devices/enable-here').send({ name: { $ne: null }, password: { $ne: null } });
    expect(res.status).toBe(400);
  });
});
