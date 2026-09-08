// A QR code on a screen is a single-use ticket, not a sign.
//
// One code, one customer. It is burned when their order arrives and lapses
// after ten idle minutes, so the screen can put a live one up in its place.
// The failure this guards against is the opposite: a code that has already
// been spent still sitting on the monitor, so the next person to walk up scans
// it and nothing happens.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const M = (n) => mongoose.model(n);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'QrSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'QrSuper');
}, 120000);

afterAll(async () => { await ctx.stop(); });

beforeEach(async () => { await M('QRSession').deleteMany({}); });

const generate = (table = 'T-ABC') => auth('post', '/api/sessions/generate').send({ table });

describe('minting a code', () => {
  it('tells the screen when it dies, so it can replace it in time', async () => {
    const { body } = await generate();
    expect(body.success).toBe(true);
    expect(body.sessionId).toMatch(/^[a-f0-9]{64}$/);
    // Without this the screen has no idea when what it is displaying goes
    // stale, which is the whole problem.
    expect(body.expiresAt).toBeTruthy();
    const left = new Date(body.expiresAt).getTime() - Date.now();
    expect(left).toBeGreaterThan(9 * 60 * 1000);
    expect(left).toBeLessThanOrEqual(10 * 60 * 1000);
  }, 30000);

  it('never leaves two live codes for the same table', async () => {
    const first = await generate();
    await generate();
    // Two codes on one table means one of them is a dud in someone's hand.
    const live = await M('QRSession').find({ table: 'T-ABC', isActive: true }).lean();
    expect(live).toHaveLength(1);
    expect(live[0].sessionId).not.toBe(first.body.sessionId);
  }, 30000);
});

describe('once a code has been used', () => {
  it('stops working', async () => {
    const { body } = await generate();
    await request(app).post(`/api/sessions/${body.sessionId}/close`).send({});

    const beat = await request(app).post(`/api/sessions/${body.sessionId}/heartbeat`).send({});
    expect(beat.status).toBe(404);
  }, 30000);

  it('leaves the table free for a fresh one', async () => {
    const first = await generate();
    await request(app).post(`/api/sessions/${first.body.sessionId}/close`).send({});

    const second = await generate();
    const beat = await request(app).post(`/api/sessions/${second.body.sessionId}/heartbeat`).send({});
    expect(beat.status).toBe(200);
    expect(beat.body.table).toBe('T-ABC');
  }, 30000);
});

describe('once a code has been sitting idle', () => {
  it('lapses, rather than staying scannable forever', async () => {
    const { body } = await generate();
    // Wind the clock past the ten minutes rather than waiting them out.
    await M('QRSession').updateOne(
      { sessionId: body.sessionId },
      { expiresAt: new Date(Date.now() - 1000) },
    );

    const beat = await request(app).post(`/api/sessions/${body.sessionId}/heartbeat`).send({});
    expect(beat.status).toBe(403);
    expect(beat.body.error).toMatch(/expired/i);
    // And it is marked dead, not just refused this once.
    expect((await M('QRSession').findOne({ sessionId: body.sessionId }).lean()).isActive).toBe(false);
  }, 30000);

  it('stays alive while the customer is still looking at it', async () => {
    const { body } = await generate();
    const before = new Date(body.expiresAt).getTime();

    const beat = await request(app).post(`/api/sessions/${body.sessionId}/heartbeat`).send({});
    expect(beat.status).toBe(200);

    const after = new Date((await M('QRSession').findOne({ sessionId: body.sessionId }).lean()).expiresAt).getTime();
    // Someone reading the menu should not have the code pulled out from under
    // them at the ten minute mark.
    expect(after).toBeGreaterThanOrEqual(before);
  }, 30000);
});
