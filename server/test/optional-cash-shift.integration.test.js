// Some shops never run a cash drawer (cashless-only, or a logistics business
// where nobody physically tenders cash) and the mandatory starting-cash prompt
// on every login is pure friction for them. `requireCashShift` (a Settings
// key, default true = today's behaviour) lets a superadmin turn that off.
//
// The rule this locks down: while off, EVERY role - not just superadmin, who
// already got a free pass - can start a shift without a starting-cash figure,
// and it is recorded at ₱0 rather than rejected.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, superTok, staffTok;
const auth = (m, p, t) => request(app)[m](p).set('Authorization', `Bearer ${t}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'ocsSuper', role: 'superadmin' });
  await makeUser({ name: 'ocsStaff', role: 'staff' });
  superTok = await loginStaff(app, 'ocsSuper');
  staffTok = await loginStaff(app, 'ocsStaff');
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('GET /api/settings/public', () => {
  it('is reachable with no token, unlike every other settings route', async () => {
    const res = await request(app).get('/api/settings/public');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('defaults to required - unset means today\'s behaviour, unchanged', async () => {
    const res = await request(app).get('/api/settings/public');
    expect(res.body.requireCashShift).toBe(true);
  });
});

describe('while cash shift is required (default)', () => {
  it('staff cannot start a shift with no starting cash', async () => {
    const res = await auth('post', '/api/shifts/start', staffTok).send({});
    expect(res.status).toBe(400);
  });

  it('staff cannot start one with a negative figure', async () => {
    const res = await auth('post', '/api/shifts/start', staffTok).send({ startingCash: -5 });
    expect(res.status).toBe(400);
  });
});

describe('once turned off', () => {
  it('flips via the generic settings PATCH and is reflected on the public endpoint', async () => {
    const patch = await auth('patch', '/api/settings/requireCashShift', superTok).send({ value: false });
    expect(patch.status).toBe(200);

    const pub = await request(app).get('/api/settings/public');
    expect(pub.body.requireCashShift).toBe(false);
  });

  it('staff can start a shift with NOTHING sent, and it records ₱0', async () => {
    const res = await auth('post', '/api/shifts/start', staffTok).send({});
    expect(res.status).toBe(200);
    expect(res.body.shift.startingCash).toBe(0);
  });

  it('a value that IS sent is still honoured - the toggle removes the requirement, not the feature', async () => {
    const res = await auth('post', '/api/shifts/start', staffTok).send({ startingCash: 500 });
    expect(res.status).toBe(200);
    expect(res.body.shift.startingCash).toBe(500);
  });

  it('a negative figure never posts as a negative starting cash - falls back to 0', async () => {
    // The requirement being off means "0 is an acceptable unstated default",
    // not "any number goes" - a negative float would make EOS variance
    // nonsensical, so it is silently floored to 0 rather than stored as-is.
    const res = await auth('post', '/api/shifts/start', staffTok).send({ startingCash: -20 });
    expect(res.status).toBe(200);
    expect(res.body.shift.startingCash).toBe(0);
  });

  it('superadmin is unaffected either way - already had the free pass', async () => {
    const res = await auth('post', '/api/shifts/start', superTok).send({});
    expect(res.status).toBe(200);
    expect(res.body.shift.startingCash).toBe(0);
  });
});

describe('turning it back on restores the requirement', () => {
  it('staff is rejected again with nothing sent', async () => {
    await auth('patch', '/api/settings/requireCashShift', superTok).send({ value: true });

    const pub = await request(app).get('/api/settings/public');
    expect(pub.body.requireCashShift).toBe(true);

    const res = await auth('post', '/api/shifts/start', staffTok).send({});
    expect(res.status).toBe(400);
  });
});
