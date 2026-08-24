// Phase 7 production-readiness pass - targeted regression tests for the
// concurrency/atomicity/RBAC fixes made in this pass: A/R settlement can't be
// double-posted, a shift can't be double-closed, EOD reopen requires an
// admin (not just any staff), and a hub transfer can't be double-accepted.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, makeClient, loginStaff } from './helpers/harness.js';

let app, stop, superToken, adminToken, staffToken;

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'log', jwtSecret: 'hardening-test-secret-0123456789' }));
  await makeUser({ name: 'HardBoss', role: 'superadmin', password: 'pw' });
  await makeUser({ name: 'HardAdmin', role: 'admin', password: 'pw' });
  await makeUser({ name: 'HardStaff', role: 'staff', password: 'pw' });
  await mongoose.model('User').updateMany({}, { $set: { tenantId: null } });
  superToken = await loginStaff(app, 'HardBoss', 'pw');
  adminToken = await loginStaff(app, 'HardAdmin', 'pw');
  staffToken = await loginStaff(app, 'HardStaff', 'pw');
}, 120000);

afterAll(async () => { await stop(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });

describe('A/R settlement cannot be double-posted', () => {
  it('a second settlement attempt on an already-settled order is rejected, not double-posted', async () => {
    const clientUsername = await makeClient({ username: 'hardclient', paymentMethod: 'Term' });
    const cliRes = await request(app).get('/api/client-accounts').set(auth(superToken));
    const client = cliRes.body.clients.find(c => c.username === clientUsername);
    await request(app).patch(`/api/client-accounts/${client._id}`).set(auth(superToken)).send({ creditLimit: 5000 });

    const orderRes = await request(app).post('/api/orders').set(auth(superToken)).send({
      items: [{ name: 'Widget', quantity: 1, price: 200 }],
      paymentMethod: 'Term',
      clientAccountId: client._id,
    });
    expect(orderRes.status).toBe(200);
    const orderId = orderRes.body.order._id;
    await request(app).put(`/api/orders/${orderId}`).set(auth(superToken)).send({ status: 'Completed' });

    const JournalEntry = mongoose.model('JournalEntry');
    const before = await JournalEntry.countDocuments({ reference: { $regex: `^ARS-` } });

    const first = await request(app).post(`/api/orders/${orderId}/settle-ar`).set(auth(superToken)).send({ amount: 200, paymentMethod: 'Cash on Hand' });
    expect(first.status).toBe(200);

    const second = await request(app).post(`/api/orders/${orderId}/settle-ar`).set(auth(superToken)).send({ amount: 200, paymentMethod: 'Cash on Hand' });
    expect(second.status).toBe(400);

    const after = await JournalEntry.countDocuments({ reference: { $regex: `^ARS-` } });
    expect(after - before).toBe(1); // exactly one settlement JE, not two
  });
});

describe('Shift end cannot be double-closed', () => {
  it('a second, sequential /end call finds no open shift left (404) - the shift stays closed exactly once', async () => {
    await request(app).post('/api/shifts/start').set(auth(staffToken)).send({ startingCash: 1000 });
    const first = await request(app).post('/api/shifts/end').set(auth(staffToken)).send({ actualCash: 1000 });
    expect(first.status).toBe(200);

    // Sequential (not concurrent), so the second call's own findOne sees no
    // Open shift at all - that's the correct, expected 404. The atomic
    // findOneAndUpdate's 409 branch exists for the TRUE race (two requests
    // both passing the findOne before either commits), which a single
    // supertest agent can't reliably simulate; what matters here is that no
    // second variance JE gets posted for one physical cash count.
    const second = await request(app).post('/api/shifts/end').set(auth(staffToken)).send({ actualCash: 1000 });
    expect(second.status).toBe(404);
  });

  it('two truly concurrent /end calls for the same shift: exactly one succeeds, exactly one variance JE posts', async () => {
    await request(app).post('/api/shifts/start').set(auth(staffToken)).send({ startingCash: 750 });
    const JournalEntry = mongoose.model('JournalEntry');
    const before = await JournalEntry.countDocuments({ description: { $regex: '^Variance adjustment: HardStaff' } });

    const [a, b] = await Promise.all([
      request(app).post('/api/shifts/end').set(auth(staffToken)).send({ actualCash: 900 }), // +150 over
      request(app).post('/api/shifts/end').set(auth(staffToken)).send({ actualCash: 900 }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses[0]).toBe(200);
    expect([404, 409]).toContain(statuses[1]); // whichever loses the race

    const after = await JournalEntry.countDocuments({ description: { $regex: '^Variance adjustment: HardStaff' } });
    expect(after - before).toBe(1); // exactly one variance entry, not two
  });

  it('rejects a missing/invalid actualCash instead of silently treating it as 0', async () => {
    await request(app).post('/api/shifts/start').set(auth(staffToken)).send({ startingCash: 500 });
    const res = await request(app).post('/api/shifts/end').set(auth(staffToken)).send({});
    expect(res.status).toBe(400);
  });

  it('a dangling open shift is marked Abandoned (not silently Closed) when a new one starts', async () => {
    await request(app).post('/api/shifts/start').set(auth(staffToken)).send({ startingCash: 300 });
    // Never call /end - simulate logging back in without ending shift.
    await request(app).post('/api/shifts/start').set(auth(staffToken)).send({ startingCash: 300 });
    const Shift = mongoose.model('Shift');
    const abandoned = await Shift.findOne({ cashierName: 'HardStaff', status: 'Abandoned' }).sort({ createdAt: -1 });
    expect(abandoned).toBeTruthy();
  });
});

describe('EOD reopen requires an admin, not just any staff', () => {
  it('rejects a plain staff account', async () => {
    const res = await request(app).post('/api/inventory/eod/reopen').set(auth(staffToken));
    expect(res.status).toBe(403);
  });
  it('allows admin', async () => {
    const res = await request(app).post('/api/inventory/eod/reopen').set(auth(adminToken));
    expect(res.status).not.toBe(403);
  });
});

describe('Hub transfer accept cannot be double-processed', () => {
  it('a second accept on an already-Received transfer is rejected, not double-posted', async () => {
    const Inventory = mongoose.model('Inventory');
    const CrossTransfer = mongoose.model('CrossTransfer');
    const item = await Inventory.create({ businessType: 'log', itemName: 'Hub Widget', stockQty: 0, unit: 'pcs', unitCost: 5 });
    const transfer = await CrossTransfer.create({
      businessType: 'log', direction: 'inbound', partnerSlug: 'fake-partner', partnerName: 'Fake Partner',
      itemName: 'Hub Widget', unit: 'pcs', qtyBase: 10, unitCost: 5, reference: 'HT-TEST-L1', shipmentRef: 'HT-TEST', status: 'Pending',
    });

    const first = await request(app).post(`/api/hub/transfers/${transfer._id}/accept`).set(auth(superToken)).send({ itemId: item._id });
    expect(first.status).toBe(200);

    const second = await request(app).post(`/api/hub/transfers/${transfer._id}/accept`).set(auth(superToken)).send({ itemId: item._id });
    expect(second.status).toBe(404); // no longer Pending

    const updated = await Inventory.findById(item._id).lean();
    expect(updated.stockQty).toBe(10); // credited exactly once, not twice
  });

  it('two truly concurrent accepts on the same transfer: exactly one succeeds, stock credited exactly once', async () => {
    const Inventory = mongoose.model('Inventory');
    const CrossTransfer = mongoose.model('CrossTransfer');
    const item = await Inventory.create({ businessType: 'log', itemName: 'Hub Widget Concurrent', stockQty: 0, unit: 'pcs', unitCost: 5 });
    const transfer = await CrossTransfer.create({
      businessType: 'log', direction: 'inbound', partnerSlug: 'fake-partner', partnerName: 'Fake Partner',
      itemName: 'Hub Widget Concurrent', unit: 'pcs', qtyBase: 25, unitCost: 5, reference: 'HT-CONC-L1', shipmentRef: 'HT-CONC', status: 'Pending',
    });

    const [a, b] = await Promise.all([
      request(app).post(`/api/hub/transfers/${transfer._id}/accept`).set(auth(superToken)).send({ itemId: item._id }),
      request(app).post(`/api/hub/transfers/${transfer._id}/accept`).set(auth(superToken)).send({ itemId: item._id }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses[0]).toBe(200);
    expect(statuses[1]).toBe(404); // withOptionalTransaction resolves the WriteConflict cleanly, not a 500

    const updated = await Inventory.findById(item._id).lean();
    expect(updated.stockQty).toBe(25); // credited exactly once, not twice or lost
  });
});
