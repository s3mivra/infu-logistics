// A pending manual order sent as a hub stock transfer instead of sold:
// to a hub partner it is filed for approval; to a new branch (not in the hub)
// it leaves stock at once. Either way the order is cancelled and the shipment
// is in the hub's transfer history.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let app, stop, token;
const auth = (t) => ({ Authorization: `Bearer ${t}` });

const mkOrder = (n, invName, qty) => mongoose.model('Order').create({
  businessType: 'log', orderNumber: n, status: 'Pending', customerName: 'MAKATI BRANCH', paymentMethod: 'Cash',
  items: [{ name: invName, price: 100, quantity: qty }], subtotal: 100 * qty, total: 100 * qty,
});

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'log', jwtSecret: 'hub-from-order-test-secret-0123456789' }));
  await makeUser({ name: 'XferBoss', role: 'superadmin', password: 'pw' });
  await mongoose.model('User').updateMany({}, { $set: { tenantId: null } });
  token = await loginStaff(app, 'XferBoss', 'pw');
}, 120000);
afterAll(async () => { await stop(); });

describe('POST /api/hub/transfers/from-order/:id', () => {
  it('to a new branch: stock leaves now, the order is cancelled, the shipment is Released', async () => {
    const inv = (await request(app).post('/api/inventory').set(auth(token)).send({ itemName: 'XFER BEANS', unit: 'pcs', stockQty: 50, unitCost: 10 })).body.item;
    const order = await mkOrder('XF-1', 'XFER BEANS', 20);
    const r = await request(app).post(`/api/hub/transfers/from-order/${order._id}`).set(auth(token)).send({ newBranch: true });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.status).toBe('Released');
    expect((await mongoose.model('Inventory').findById(inv._id).lean()).stockQty).toBe(30);
    expect(await mongoose.model('Order').findById(order._id).lean()).toMatchObject({ status: 'Cancelled', transferRef: r.body.shipmentRef });
    const list = (await request(app).get('/api/hub/transfers').set(auth(token))).body.transfers;
    const t = list.find(x => x.shipmentRef === r.body.shipmentRef);
    expect(t).toMatchObject({ partnerName: 'MAKATI BRANCH', billedTo: 'MAKATI BRANCH', qtyBase: 20, status: 'Released', direction: 'outbound' });
  });

  it('to a hub partner: filed as Requested, stock untouched until approved', async () => {
    const inv = (await request(app).post('/api/inventory').set(auth(token)).send({ itemName: 'XFER CUPS', unit: 'pcs', stockQty: 40, unitCost: 2 })).body.item;
    await mongoose.model('LinkedBusiness').create({ businessType: 'log', role: 'client', partnerSlug: 'xf-partner', partnerName: 'XF Partner', partnerUrl: 'http://unreachable.invalid', linkToken: 'xf-token', status: 'active' });
    const order = await mkOrder('XF-2', 'XFER CUPS', 5);
    const r = await request(app).post(`/api/hub/transfers/from-order/${order._id}`).set(auth(token)).send({ partnerSlug: 'xf-partner' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.status).toBe('Requested');
    expect((await mongoose.model('Inventory').findById(inv._id).lean()).stockQty).toBe(40);
  });

  it('preview prices the order at cost and changes nothing', async () => {
    await request(app).post('/api/inventory').set(auth(token)).send({ itemName: 'XFER MUGS', unit: 'pcs', stockQty: 10, unitCost: 7 });
    const order = await mkOrder('XF-4', 'XFER MUGS', 4);
    const r = await request(app).post(`/api/hub/transfers/from-order/${order._id}`).set(auth(token)).send({ preview: true });
    expect(r.body).toMatchObject({ preview: true, total: 28, orderTotal: 400 });
    expect((await mongoose.model('Order').findById(order._id).lean()).status).toBe('Pending');
  });

  it('refuses when there is not enough stock, and leaves the order alone', async () => {
    await request(app).post('/api/inventory').set(auth(token)).send({ itemName: 'XFER LIDS', unit: 'pcs', stockQty: 3, unitCost: 1 });
    const order = await mkOrder('XF-3', 'XFER LIDS', 10);
    const r = await request(app).post(`/api/hub/transfers/from-order/${order._id}`).set(auth(token)).send({ newBranch: true });
    expect(r.status).toBe(409);
    expect((await mongoose.model('Order').findById(order._id).lean()).status).toBe('Pending');
  });
});

describe('Send as stock transfer: its own permission', () => {
  it('needs orders.transfer', async () => {
    await makeUser({ name: 'XferClerk', role: 'staff', password: 'pw', permissions: ['pos.use', 'orders.view', 'inventory.manage'] });
    await mongoose.model('User').updateMany({}, { $set: { tenantId: null } });
    const clerk = await loginStaff(app, 'XferClerk', 'pw');
    const order = await mkOrder('XF-9', 'XFER BEANS', 1);
    const r = await request(app).post(`/api/hub/transfers/from-order/${order._id}`).set(auth(clerk)).send({ preview: true });
    expect(r.status).toBe(403);
  });
});

describe('Void a stock transfer', () => {
  it('a transfer to a new branch: stock comes back, entry reversed, needs a reason', async () => {
    const inv = (await request(app).post('/api/inventory').set(auth(token)).send({ itemName: 'VOID BEANS', unit: 'pcs', stockQty: 50, unitCost: 10 })).body.item;
    const order = await mkOrder('XF-V1', 'VOID BEANS', 20);
    const sent = await request(app).post(`/api/hub/transfers/from-order/${order._id}`).set(auth(token)).send({ newBranch: true });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect((await mongoose.model('Inventory').findById(inv._id).lean()).stockQty).toBe(30);

    const noReason = await request(app).post('/api/hub/transfers/void').set(auth(token)).send({ shipmentRef: sent.body.shipmentRef });
    expect(noReason.status).toBe(400);
    const r = await request(app).post('/api/hub/transfers/void').set(auth(token)).send({ shipmentRef: sent.body.shipmentRef, reason: 'wrong branch' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.valueReturned).toBe(200);
    expect((await mongoose.model('Inventory').findById(inv._id).lean()).stockQty).toBe(50);
    const lines = await mongoose.model('CrossTransfer').find({ shipmentRef: sent.body.shipmentRef }).lean();
    expect(lines.every(l => l.status === 'Voided' && l.voidReason === 'wrong branch')).toBe(true);
    const je = await mongoose.model('JournalEntry').findOne({ reference: `${lines[0].reference}-VOID` }).lean();
    expect(je.lines.find(l => l.accountCode === '130000').debit).toBe(200);
    const again = await request(app).post('/api/hub/transfers/void').set(auth(token)).send({ shipmentRef: sent.body.shipmentRef, reason: 'again' });
    expect(again.status).toBe(409);
  });

  it('refuses a shipment a hub partner has been sent', async () => {
    await request(app).post('/api/inventory').set(auth(token)).send({ itemName: 'VOID CUPS', unit: 'pcs', stockQty: 40, unitCost: 2 });
    const order = await mkOrder('XF-V2', 'VOID CUPS', 5);
    const sent = await request(app).post(`/api/hub/transfers/from-order/${order._id}`).set(auth(token)).send({ partnerSlug: 'xf-partner' });
    await mongoose.model('CrossTransfer').updateMany({ shipmentRef: sent.body.shipmentRef }, { $set: { status: 'Pending' } });
    const r = await request(app).post('/api/hub/transfers/void').set(auth(token)).send({ shipmentRef: sent.body.shipmentRef, reason: 'x' });
    expect(r.status).toBe(409);
  });
});
