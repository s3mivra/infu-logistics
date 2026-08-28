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
    // Unreachable partner URL - shipment still lands locally, just warns.
    expect(res.body.warning).toMatch(/could not notify partner/);

    const CrossTransfer = mongoose.model('CrossTransfer');
    const saved = await CrossTransfer.findOne({ partnerSlug: 'real-shape-partner', itemId }).lean();
    expect(saved).toBeTruthy();
    expect(saved.status).toBe('Pending');

    const invAfter = await mongoose.model('Inventory').findById(itemId).lean();
    // Outbound stock isn't deducted until the partner accepts - stays on hand as Pending.
    expect(invAfter.stockQty).toBe(5000);
  });
});
