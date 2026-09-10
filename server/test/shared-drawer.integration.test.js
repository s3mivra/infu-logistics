// Shared cash drawer: one session for the shop, many people ringing on it.
//
// The original model gave every cashier their own float. A bar where three
// baristas share one till cannot use it: each would declare the same physical
// money, so the books would believe three times the cash was in the drawer and
// every variance would be arithmetic about a till that never existed.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let app, stop, boss, ana, ben;

const setSetting = async (key, value) => {
  await mongoose.model('Settings').findOneAndUpdate({ key }, { value }, { upsert: true });
};

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'fb', jwtSecret: 'drawer-secret-0123456789' }));
  await makeUser({ name: 'DrawerBoss', role: 'superadmin', password: 'pw' });
  await makeUser({ name: 'Ana', role: 'cashier', password: 'pw' });
  await makeUser({ name: 'Ben', role: 'cashier', password: 'pw' });
  boss = await loginStaff(app, 'DrawerBoss', 'pw');
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
});

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const sell = (tok, amount) => request(app).post('/api/orders').set(auth(tok))
  .send({ items: [{ name: 'Latte', price: amount, quantity: 1 }], table: 'Takeout', paymentMethod: 'Cash' })
  .then(r => request(app).put(`/api/orders/${r.body.order._id}`).set(auth(tok)).send({ status: 'Completed' }));

describe('shared drawer', () => {
  it('the second person to log in JOINS the open session instead of opening a second float', async () => {
    const first = await request(app).post('/api/shifts/start').set(auth(ana)).send({ startingCash: 2000 });
    expect(first.body.joined).toBe(false);
    expect(first.body.shift.scope).toBe('drawer');

    const second = await request(app).post('/api/shifts/start').set(auth(ben)).send({ startingCash: 2000 });
    expect(second.body.joined).toBe(true);
    // The float is declared once. Two sessions would put 4,000 on the books
    // against a 2,000 till.
    expect(String(second.body.shift._id)).toBe(String(first.body.shift._id));
    expect(await mongoose.model('Shift').countDocuments({ status: 'Open' })).toBe(1);
  });

  it('counts every cash sale on the drawer, whoever rang it', async () => {
    await request(app).post('/api/shifts/start').set(auth(ana)).send({ startingCash: 1000 });
    await request(app).post('/api/shifts/start').set(auth(ben)).send({});

    await sell(ana, 150);
    await sell(ben, 250);

    // Ben closes the drawer Ana opened - normal on a shared till.
    const closed = await request(app).post('/api/shifts/end').set(auth(ben)).send({ actualCash: 1400 });
    expect(closed.status).toBe(200);
    // 1000 float + 150 + 250, NOT just the closer's own takings.
    expect(closed.body.shift.salesTotal).toBe(400);
    expect(closed.body.shift.expectedCash).toBe(1400);
    expect(closed.body.shift.variance).toBe(0);
    expect(closed.body.shift.closedBy).toBe('Ben');
    expect(closed.body.shift.openedBy).toBe('Ana');
  });

  it('pay-ins and pay-outs move the expected figure', async () => {
    await request(app).post('/api/shifts/start').set(auth(ana)).send({ startingCash: 1000 });
    await sell(ana, 200);
    // Milk bought out of the till, and a note broken for change.
    await request(app).post('/api/shifts/movement').set(auth(ana)).send({ type: 'out', amount: 300, reason: 'Milk run' });
    await request(app).post('/api/shifts/movement').set(auth(ben)).send({ type: 'in', amount: 500, reason: 'Change float top-up' });

    const closed = await request(app).post('/api/shifts/end').set(auth(ana)).send({ actualCash: 1400 });
    // 1000 + 200 - 300 + 500 = 1400. Without movements this would read as a
    // 200 short and staff would stop believing the number.
    expect(closed.body.shift.expectedCash).toBe(1400);
    expect(closed.body.shift.variance).toBe(0);
    expect(closed.body.shift.payOutsTotal).toBe(300);
    expect(closed.body.shift.payInsTotal).toBe(500);
  });

  it('a movement without a reason is refused', async () => {
    await request(app).post('/api/shifts/start').set(auth(ana)).send({ startingCash: 500 });
    const res = await request(app).post('/api/shifts/movement').set(auth(ana)).send({ type: 'out', amount: 100, reason: '  ' });
    expect(res.status).toBe(400);
    const bad = await request(app).post('/api/shifts/movement').set(auth(ana)).send({ type: 'out', amount: -5, reason: 'x' });
    expect(bad.status).toBe(400);
  });

  it('a movement posts NO journal entry - the expense or deposit does that', async () => {
    await request(app).post('/api/shifts/start').set(auth(ana)).send({ startingCash: 500 });
    const before = await mongoose.model('JournalEntry').countDocuments({});
    await request(app).post('/api/shifts/movement').set(auth(ana)).send({ type: 'out', amount: 100, reason: 'Milk' });
    // Posting here as well as when the expense is filed would credit the same
    // cash twice.
    expect(await mongoose.model('JournalEntry').countDocuments({})).toBe(before);
  });

  it('flags a close past the variance threshold and leaves a small one alone', async () => {
    await request(app).post('/api/shifts/start').set(auth(ana)).send({ startingCash: 1000 });
    const small = await request(app).post('/api/shifts/end').set(auth(ana)).send({ actualCash: 990 });
    expect(small.body.shift.needsReview).toBe(false);

    await request(app).post('/api/shifts/start').set(auth(ana)).send({ startingCash: 1000 });
    const big = await request(app).post('/api/shifts/end').set(auth(ana)).send({ actualCash: 800 });
    expect(big.body.shift.variance).toBe(-200);
    expect(big.body.shift.needsReview).toBe(true);
  });

  it('a blind close hides the target from staff but not from a manager', async () => {
    await setSetting('blindClose', true);
    await request(app).post('/api/shifts/start').set(auth(ana)).send({ startingCash: 1000 });
    await sell(ana, 300);

    const staffView = await request(app).get('/api/shifts/current').set(auth(ana));
    expect(staffView.body.blind).toBe(true);
    // Seeing the number you are meant to reach turns counting into copying.
    expect(staffView.body.shift.expectedCash).toBeUndefined();
    expect(staffView.body.shift.salesTotal).toBeUndefined();

    const bossView = await request(app).get('/api/shifts/current').set(auth(boss));
    expect(bossView.body.blind).toBe(false);
    expect(bossView.body.shift.expectedCash).toBe(1300);
  });

  it('still posts the Cash Short and Over entry', async () => {
    await request(app).post('/api/shifts/start').set(auth(ana)).send({ startingCash: 1000 });
    await request(app).post('/api/shifts/end').set(auth(ana)).send({ actualCash: 940 });
    const je = await mongoose.model('JournalEntry').findOne({ description: /Variance adjustment/ }).lean();
    expect(je).toBeTruthy();
    expect(je.totalDebit).toBeCloseTo(je.totalCredit, 6);
    expect(je.description).toContain('drawer');
  });

  it('per-cashier shifts still work when the drawer is switched off', async () => {
    await setSetting('sharedDrawer', false);
    const a = await request(app).post('/api/shifts/start').set(auth(ana)).send({ startingCash: 500 });
    const b = await request(app).post('/api/shifts/start').set(auth(ben)).send({ startingCash: 700 });
    expect(a.body.shift.scope).toBe('cashier');
    expect(b.body.joined).toBe(false);
    expect(String(b.body.shift._id)).not.toBe(String(a.body.shift._id));

    await sell(ana, 100);
    await sell(ben, 200);
    // Each answers only for their own till, exactly as before.
    const closedA = await request(app).post('/api/shifts/end').set(auth(ana)).send({ actualCash: 600 });
    expect(closedA.body.shift.salesTotal).toBe(100);
    expect(closedA.body.shift.variance).toBe(0);
  });
});
