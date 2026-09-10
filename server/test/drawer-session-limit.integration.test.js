// Bounding a cash drawer session in time.
//
// Logging out no longer closes a shared drawer - correctly, since the money is
// still in it and other people are still selling - but nothing else closes a
// cash session either, so a forgotten close would sweep the next day's sales
// into yesterday's count. A session limit bounds it.
//
// The limit is a DURATION, not a midnight cut-off: a 24/7 counter is at its
// busiest at midnight, and closing the till mid-service is worse than leaving
// it open. And an overrun session is closed UNCOUNTED - never with an invented
// count, which would manufacture a flawless reconciliation for a till nobody
// opened and destroy the only control this feature provides.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let app, stop, ana;

const setSetting = async (key, value) => {
  await mongoose.model('Settings').findOneAndUpdate({ key }, { value }, { upsert: true });
};

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'fb', jwtSecret: 'limit-secret-0123456789' }));
  await makeUser({ name: 'Ana', role: 'cashier', password: 'pw' });
  ana = await loginStaff(app, 'Ana', 'pw');
}, 120000);

afterAll(async () => { await stop(); });

beforeEach(async () => {
  await mongoose.model('Shift').deleteMany({});
  await mongoose.model('Order').deleteMany({});
  await mongoose.model('JournalEntry').deleteMany({});
  await setSetting('sharedDrawer', true);
  await setSetting('blindClose', false);
  await setSetting('varianceThreshold', 50);
  await setSetting('drawerMaxHours', 12);
});

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const ageOpenSession = async (hours) => {
  await mongoose.model('Shift').updateOne(
    { status: 'Open' },
    { $set: { shiftStart: new Date(Date.now() - hours * 3600000) } },
  );
};

describe('drawer session limit', () => {
  it('closes a session that outran the limit, WITHOUT inventing a count', async () => {
    await request(app).post('/api/shifts/start').set(auth(ana)).send({ startingCash: 1000 });
    await ageOpenSession(20);

    await request(app).get('/api/shifts/current').set(auth(ana));

    const shift = await mongoose.model('Shift').findOne({}).lean();
    expect(shift.status).toBe('Closed');
    expect(shift.systemClosed).toBe(true);
    expect(shift.needsReview).toBe(true);
    // The whole point: no fabricated count, and therefore no fabricated
    // variance. A zero variance here would be a lie about a till nobody opened.
    expect(shift.actualCash === undefined || shift.actualCash === null).toBe(true);
    expect(shift.variance === undefined || shift.variance === null).toBe(true);
    // Expected IS computed, so whoever reconciles it has the figure to work from.
    expect(shift.expectedCash).toBe(1000);
  });

  it('posts no Cash Short and Over entry for an uncounted close', async () => {
    await request(app).post('/api/shifts/start').set(auth(ana)).send({ startingCash: 1000 });
    await ageOpenSession(20);
    await request(app).get('/api/shifts/current').set(auth(ana));
    // Nobody counted, so there is no difference to book.
    expect(await mongoose.model('JournalEntry').countDocuments({ description: /Variance adjustment/ })).toBe(0);
  });

  it('the next login opens a fresh drawer rather than joining yesterday', async () => {
    const first = await request(app).post('/api/shifts/start').set(auth(ana)).send({ startingCash: 1000 });
    await ageOpenSession(20);

    const next = await request(app).post('/api/shifts/start').set(auth(ana)).send({ startingCash: 1500 });
    expect(next.body.joined).toBe(false);
    expect(String(next.body.shift._id)).not.toBe(String(first.body.shift._id));
    expect(next.body.shift.startingCash).toBe(1500);
    expect(await mongoose.model('Shift').countDocuments({ status: 'Open' })).toBe(1);
  });

  it('leaves a session inside the limit alone', async () => {
    await request(app).post('/api/shifts/start').set(auth(ana)).send({ startingCash: 800 });
    await ageOpenSession(6);
    await request(app).get('/api/shifts/current').set(auth(ana));
    const shift = await mongoose.model('Shift').findOne({}).lean();
    expect(shift.status).toBe('Open');
    expect(shift.systemClosed).toBe(false);
  });

  it('a limit of 0 means no boundary - for a shop that closes its own till', async () => {
    await setSetting('drawerMaxHours', 0);
    await request(app).post('/api/shifts/start').set(auth(ana)).send({ startingCash: 800 });
    await ageOpenSession(500);
    await request(app).get('/api/shifts/current').set(auth(ana));
    expect((await mongoose.model('Shift').findOne({}).lean()).status).toBe('Open');
  });

  it('reports how long the open session has been running', async () => {
    await request(app).post('/api/shifts/start').set(auth(ana)).send({ startingCash: 500 });
    await ageOpenSession(5);
    const res = await request(app).get('/api/shifts/current').set(auth(ana));
    expect(res.body.shift.openHours).toBeGreaterThan(4.9);
    expect(res.body.maxOpenHours).toBe(12);
  });

  it('rejects a nonsensical session limit', async () => {
    const boss = await makeUser({ name: 'LimitBoss', role: 'superadmin', password: 'pw' }).then(() => loginStaff(app, 'LimitBoss', 'pw'));
    const bad = await request(app).patch('/api/settings/drawerMaxHours').set(auth(boss)).send({ value: -1 });
    expect(bad.status).toBe(400);
    const tooBig = await request(app).patch('/api/settings/drawerMaxHours').set(auth(boss)).send({ value: 5000 });
    expect(tooBig.status).toBe(400);
  });
});
