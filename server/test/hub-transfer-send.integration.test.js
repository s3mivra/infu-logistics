// Hub "New Transfer" widget (HubTab.jsx) posts { partnerSlug, items: [{itemId, qty,
// note}] } to /api/hub/transfers/send - the client once sent a flat { partnerSlug,
// itemId, qtyBase, note } shape instead (no `items` array), so the server's own
// validation ("partnerSlug and items[] are required") rejected every real transfer
// even though the form looked fully filled in. Lock the correct shape in place.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let app, stop, superToken;
const auth = (t) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'log', jwtSecret: 'hub-transfer-send-test-secret-0123456789' }));
  await makeUser({ name: 'SendBoss', role: 'superadmin', password: 'pw' });
  await mongoose.model('User').updateMany({}, { $set: { tenantId: null } });
  superToken = await loginStaff(app, 'SendBoss', 'pw');
}, 120000);

afterAll(async () => { await stop(); });

describe('POST /api/hub/transfers/send', () => {
  it('rejects the old flat body shape the client used to send (no items[])', async () => {
    const LinkedBusiness = mongoose.model('LinkedBusiness');
    await LinkedBusiness.create({
      businessType: 'log', role: 'client', partnerSlug: 'flat-body-partner', partnerName: 'Flat Body Partner',
      partnerUrl: 'http://unreachable.invalid', linkToken: 'flat-body-token', status: 'active',
    });
    const res = await request(app).post('/api/hub/transfers/send').set(auth(superToken))
      .send({ partnerSlug: 'flat-body-partner', itemId: '000000000000000000000000', qtyBase: 5, note: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/items\[\]/);
  });

  it('accepts the real (current) client shape - { partnerSlug, items: [{itemId, qty, note}] } - and creates the shipment', async () => {
    const invRes = await request(app).post('/api/inventory').set(auth(superToken))
      .send({ itemName: 'Hub Send Widget', unit: 'ml', stockQty: 5000, unitCost: 1 });
    const itemId = invRes.body.item._id;

    const LinkedBusiness = mongoose.model('LinkedBusiness');
    await LinkedBusiness.create({
      businessType: 'log', role: 'client', partnerSlug: 'real-shape-partner', partnerName: 'Real Shape Partner',
      partnerUrl: 'http://unreachable.invalid', linkToken: 'real-shape-token', status: 'active',
    });

    const res = await request(app).post('/api/hub/transfers/send').set(auth(superToken))
      .send({ partnerSlug: 'real-shape-partner', items: [{ itemId, qty: 4000, note: 'test shipment' }] });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.transfers).toHaveLength(1);
    expect(res.body.transfers[0].qtyBase).toBe(4000);
    // Sending only FILES the slip now - the partner is not told about a
    // cross-business shipment until it has been approved.
    expect(res.body.status).toBe('Requested');

    const CrossTransfer = mongoose.model('CrossTransfer');
    const saved = await CrossTransfer.findOne({ partnerSlug: 'real-shape-partner', itemId }).lean();
    expect(saved).toBeTruthy();
    expect(saved.status).toBe('Requested');
    expect(saved.requestedBy).toBe('SendBoss');

    const invAfter = await mongoose.model('Inventory').findById(itemId).lean();
    // Outbound stock isn't deducted until the partner accepts - stays on hand.
    expect(invAfter.stockQty).toBe(5000);
  });

  it('approval is what notifies the partner - an unreachable partner leaves the slip awaiting approval', async () => {
    const invRes = await request(app).post('/api/inventory').set(auth(superToken))
      .send({ itemName: 'Hub Approve Widget', unit: 'ml', stockQty: 900, unitCost: 1 });
    const itemId = invRes.body.item._id;

    await mongoose.model('LinkedBusiness').create({
      businessType: 'log', role: 'client', partnerSlug: 'approve-partner', partnerName: 'Approve Partner',
      partnerUrl: 'http://unreachable.invalid', linkToken: 'approve-token', status: 'active',
    });

    const filed = await request(app).post('/api/hub/transfers/send').set(auth(superToken))
      .send({ partnerSlug: 'approve-partner', items: [{ itemId, qty: 100 }] });
    const { shipmentRef } = filed.body;

    // Partner is unreachable, so approval must fail LOUDLY and leave the slip
    // untouched - a half-sent cross-business shipment is worse than an unsent one.
    const approve = await request(app).post('/api/hub/transfers/approve').set(auth(superToken))
      .send({ shipmentRef });
    expect(approve.status).toBe(502);

    const CrossTransfer = mongoose.model('CrossTransfer');
    const still = await CrossTransfer.findOne({ shipmentRef }).lean();
    expect(still.status).toBe('Requested');
    expect(still.approvedBy).toBe('');
  });

  it('refuses to approve a slip whose stock has since been transferred away', async () => {
    const invRes = await request(app).post('/api/inventory').set(auth(superToken))
      .send({ itemName: 'Hub Shortage Widget', unit: 'ml', stockQty: 500, unitCost: 1 });
    const itemId = invRes.body.item._id;

    await mongoose.model('LinkedBusiness').create({
      businessType: 'log', role: 'client', partnerSlug: 'shortage-partner', partnerName: 'Shortage Partner',
      partnerUrl: 'http://unreachable.invalid', linkToken: 'shortage-token', status: 'active',
    });

    const filed = await request(app).post('/api/hub/transfers/send').set(auth(superToken))
      .send({ partnerSlug: 'shortage-partner', items: [{ itemId, qty: 500 }] });
    const { shipmentRef } = filed.body;

    // Stock walks out between filing and approval.
    await mongoose.model('Inventory').updateOne({ _id: itemId }, { $set: { stockQty: 10 } });

    const approve = await request(app).post('/api/hub/transfers/approve').set(auth(superToken))
      .send({ shipmentRef });
    expect(approve.status).toBe(409);
    expect(approve.body.error).toMatch(/stock changed/i);
  });

  it('rejecting a filed slip closes it without ever touching stock', async () => {
    const invRes = await request(app).post('/api/inventory').set(auth(superToken))
      .send({ itemName: 'Hub Reject Widget', unit: 'ml', stockQty: 300, unitCost: 1 });
    const itemId = invRes.body.item._id;

    await mongoose.model('LinkedBusiness').create({
      businessType: 'log', role: 'client', partnerSlug: 'reject-partner', partnerName: 'Reject Partner',
      partnerUrl: 'http://unreachable.invalid', linkToken: 'reject-token', status: 'active',
    });

    const filed = await request(app).post('/api/hub/transfers/send').set(auth(superToken))
      .send({ partnerSlug: 'reject-partner', items: [{ itemId, qty: 50 }] });
    const { shipmentRef } = filed.body;

    const rejected = await request(app).post('/api/hub/transfers/reject').set(auth(superToken))
      .send({ shipmentRef, reason: 'Not authorised this month.' });
    expect(rejected.status).toBe(200);
    expect(rejected.body.rejected).toBe(1);

    const saved = await mongoose.model('CrossTransfer').findOne({ shipmentRef }).lean();
    expect(saved.status).toBe('Rejected');
    expect(saved.rejectionReason).toBe('Not authorised this month.');

    const invAfter = await mongoose.model('Inventory').findById(itemId).lean();
    expect(invAfter.stockQty).toBe(300);
  });
});
