// Handover: count the till, then carry the counted cash straight into the next
// session as its float.
//
// The money never left the drawer - somebody counted it and it is still sitting
// there - so making the next person retype the figure they just watched being
// counted is friction that invites a typo into the one number the next
// reconciliation is measured against.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let app, stop, ana, ben;

const setSetting = async (key, value) => {
  await mongoose.model('Settings').findOneAndUpdate({ key }, { value }, { upsert: true });
};

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'fb', jwtSecret: 'handover-secret-0123456789' }));
  await makeUser({ name: 'Ana', role: 'cashier', password: 'pw' });
  await makeUser({ name: 'Ben', role: 'cashier', password: 'pw' });
  ana = await loginStaff(app, 'Ana', 'pw');
  ben = await loginStaff(app, 'Ben', 'pw');
}, 120000);

afterAll(async () => { await stop(); });

beforeEach(async () => {
  await mongoose.model('Shift').deleteMany({});
  await mongoose.model('Order').deleteMany({});
  await setSetting('sharedDrawer', true);
  await setSetting('blindClose', false);
  await setSetting('varianceThreshold', 50);
  await setSetting('drawerMaxHours', 0);
});

const auth = (t) => ({ Authorization: `Bearer ${t}` });

describe('drawer handover', () => {
  it('closes the session and reopens with the counted cash as the new float', async () => {
    await request(app).post('/api/shifts/start').set(auth(ana)).send({ startingCash: 1000 });

    const res = await request(app).post('/api/shifts/end').set(auth(ben))
      .send({ actualCash: 1250, handover: true });

    expect(res.status).toBe(200);
    expect(res.body.handedOver).toBe(true);
    // The closed session keeps its own count and variance.
    expect(res.body.shift.status).toBe('Closed');
    expect(res.body.shift.actualCash).toBe(1250);
    expect(res.body.shift.closedBy).toBe('Ben');
    // The new one starts from what was physically counted, not a retyped guess.
    expect(res.body.nextShift.startingCash).toBe(1250);
    expect(res.body.nextShift.status).toBe('Open');
    expect(res.body.nextShift.openedBy).toBe('Ben');

    // Still exactly one open drawer, which the unique index guarantees.
    expect(await mongoose.model('Shift').countDocuments({ scope: 'drawer', status: 'Open' })).toBe(1);
  });

  it('the next person joins the handed-over session without declaring a float', async () => {
    await request(app).post('/api/shifts/start').set(auth(ana)).send({ startingCash: 800 });
    const handed = await request(app).post('/api/shifts/end').set(auth(ana)).send({ actualCash: 900, handover: true });

    const joining = await request(app).post('/api/shifts/start').set(auth(ben)).send({});
    expect(joining.body.joined).toBe(true);
    expect(String(joining.body.shift._id)).toBe(String(handed.body.nextShift._id));
    expect(joining.body.shift.startingCash).toBe(900);
  });

  it('a plain close leaves no session open', async () => {
    await request(app).post('/api/shifts/start').set(auth(ana)).send({ startingCash: 500 });
    const res = await request(app).post('/api/shifts/end').set(auth(ana)).send({ actualCash: 500 });
    expect(res.body.handedOver).toBe(false);
    expect(res.body.nextShift).toBeUndefined();
    expect(await mongoose.model('Shift').countDocuments({ status: 'Open' })).toBe(0);
  });

  it('a handover still records the variance for the session being closed', async () => {
    await request(app).post('/api/shifts/start').set(auth(ana)).send({ startingCash: 1000 });
    const res = await request(app).post('/api/shifts/end').set(auth(ana)).send({ actualCash: 940, handover: true });
    // Handing over must not launder a shortfall - the closed session owns it.
    expect(res.body.shift.variance).toBe(-60);
    expect(res.body.shift.needsReview).toBe(true);
    expect(res.body.nextShift.startingCash).toBe(940);
    const je = await mongoose.model('JournalEntry').findOne({ description: /Variance adjustment/ }).lean();
    expect(je).toBeTruthy();
  });

  it('handover does not apply to per-cashier shifts', async () => {
    await setSetting('sharedDrawer', false);
    await request(app).post('/api/shifts/start').set(auth(ana)).send({ startingCash: 300 });
    const res = await request(app).post('/api/shifts/end').set(auth(ana)).send({ actualCash: 300, handover: true });
    // A personal till is handed to nobody - it belongs to one person and ends.
    expect(res.body.handedOver).toBe(false);
    expect(await mongoose.model('Shift').countDocuments({ status: 'Open' })).toBe(0);
  });
});
