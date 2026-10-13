// What one linked business may do to another's records.
//
// A link token proves "this call is from a business we are linked with". It
// does not prove WHICH shipment or request is theirs to touch - that has to be
// checked on every internal route, or any linked business can act on another's.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let app, stop, superToken, staffToken;
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const asPartner = (path, token) => request(app).post(path).set('x-link-token', token);
const M = (n) => mongoose.model(n);
const TENANT = (process.env.MONGO_URI || '').match(/\/semivra_([^?/]+)/)?.[1] || 'unknown';
const ref = (p) => `${p}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

async function stock(name, qty = 100, unitCost = 10) {
  const r = await request(app).post('/api/inventory').set(auth(superToken)).send({ itemName: name, unit: 'pcs', stockQty: qty, unitCost });
  return r.body.item._id;
}
const outbound = (over) => M('CrossTransfer').create({
  businessType: 'log', direction: 'outbound', partnerSlug: 'alpha', partnerName: 'Alpha',
  itemName: 'Thing', unit: 'pcs', qtyBase: 10, unitCost: 10, status: 'Pending', shipmentRef: 'HT-X', ...over,
});

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'log', jwtSecret: 'hub-partner-trust-test-secret-0123456789' }));
  await makeUser({ name: 'TrustBoss', role: 'superadmin', password: 'pw' });
  await makeUser({ name: 'TrustStaff', role: 'staff', password: 'pw' });
  await M('User').updateMany({}, { $set: { tenantId: null } });
  superToken = await loginStaff(app, 'TrustBoss', 'pw');
  staffToken = await loginStaff(app, 'TrustStaff', 'pw');
  for (const [slug, name] of [['alpha', 'Alpha'], ['beta', 'Beta']]) {
    await M('LinkedBusiness').create({
      businessType: 'log', role: 'client', partnerSlug: slug, partnerName: name,
      partnerUrl: 'http://unreachable.invalid', linkToken: `${slug}-token`, status: 'active',
    });
  }
}, 120000);

afterAll(async () => { await stop(); });

describe('the link token stays between the two servers', () => {
  it('is not in the list of links a signed-in member of staff can read', async () => {
    const res = await request(app).get('/api/hub/info').set(auth(staffToken));
    expect(res.status).toBe(200);
    expect(res.body.links.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(res.body)).not.toMatch(/alpha-token|beta-token|linkToken/);
  });
});

describe('a shipment announced to us', () => {
  it('is from whoever is calling, whatever the body claims', async () => {
    const reference = ref('HT-N');
    const res = await asPartner('/api/hub/internal/transfer-notify', 'alpha-token').send({
      shipmentRef: 'HT-N', fromSlug: 'beta', fromName: 'Beta',
      items: [{ reference, itemName: 'Widget', unit: 'pcs', qtyBase: 5, unitCost: 3 }],
    });
    expect(res.status).toBe(200);
    const row = await M('CrossTransfer').findOne({ reference }).lean();
    expect(row.partnerSlug).toBe('alpha');
    expect(row.partnerName).toBe('Alpha');
  });

  it('refuses a quantity that is not above zero - it would take stock out on acceptance', async () => {
    for (const qtyBase of [-5, 0, 'lots']) {
      const reference = ref('HT-BAD');
      const res = await asPartner('/api/hub/internal/transfer-notify', 'alpha-token').send({
        shipmentRef: 'HT-BAD', items: [{ reference, itemName: 'Widget', unit: 'pcs', qtyBase }],
      });
      expect(res.status, String(qtyBase)).toBe(400);
      expect(await M('CrossTransfer').exists({ reference })).toBeNull();
    }
  });

  it('announced twice is still one shipment', async () => {
    const reference = ref('HT-TWICE');
    const body = { shipmentRef: 'HT-TWICE', items: [{ reference, itemName: 'Widget', unit: 'pcs', qtyBase: 5 }] };
    expect((await asPartner('/api/hub/internal/transfer-notify', 'alpha-token').send(body)).body.added).toBe(1);
    expect((await asPartner('/api/hub/internal/transfer-notify', 'alpha-token').send(body)).body.added).toBe(0);
    expect(await M('CrossTransfer').countDocuments({ reference })).toBe(1);
  });
});

describe('a shipment we sent to one business', () => {
  it('cannot be released by another - our stock stays where it is', async () => {
    const itemId = await stock('Release Guard', 100, 10);
    const reference = ref('HT-REL');
    await outbound({ reference, itemId });

    await asPartner('/api/hub/internal/transfer-release', 'beta-token').send({ reference });
    expect((await M('Inventory').findById(itemId).lean()).stockQty).toBe(100);
    expect((await M('CrossTransfer').findOne({ reference }).lean()).status).toBe('Pending');

    // The business it was sent to can, once, and asking again changes nothing.
    await asPartner('/api/hub/internal/transfer-release', 'alpha-token').send({ reference });
    await asPartner('/api/hub/internal/transfer-release', 'alpha-token').send({ reference });
    expect((await M('Inventory').findById(itemId).lean()).stockQty).toBe(90);
    expect((await M('CrossTransfer').findOne({ reference }).lean()).status).toBe('Released');
  });

  it('leaves at the cost it was sent at, so the two clearing entries cancel', async () => {
    const itemId = await stock('Release Value', 100, 10);
    const reference = ref('HT-VAL');
    await outbound({ reference, itemId, qtyBase: 10, unitCost: 10 });
    // The carrying cost moves between sending and receiving.
    await M('Inventory').updateOne({ _id: itemId }, { $set: { unitCost: 14 } });
    await asPartner('/api/hub/internal/transfer-release', 'alpha-token').send({ reference });
    const je = await M('JournalEntry').findOne({ reference }).lean();
    expect(je.totalDebit).toBe(100);   // 10 x 10, what the receiver booked - not 10 x 14
  });

  it('never approved cannot be released at all', async () => {
    const itemId = await stock('Release Unapproved', 50, 10);
    const reference = ref('HT-REQ');
    await outbound({ reference, itemId, status: 'Requested' });
    const res = await asPartner('/api/hub/internal/transfer-release', 'alpha-token').send({ reference });
    expect(res.status).toBe(409);
    expect((await M('Inventory').findById(itemId).lean()).stockQty).toBe(50);
  });

  it('can only be marked rejected by the business it went to, and only while it is waiting', async () => {
    const reference = ref('HT-ST');
    await outbound({ reference });
    await asPartner('/api/hub/internal/transfer-status', 'beta-token').send({ reference, status: 'Rejected' });
    expect((await M('CrossTransfer').findOne({ reference }).lean()).status).toBe('Pending');

    const junk = await asPartner('/api/hub/internal/transfer-status', 'alpha-token').send({ reference, status: 'Released' });
    expect(junk.status).toBe(400);
    expect((await M('CrossTransfer').findOne({ reference }).lean()).status).toBe('Pending');

    await asPartner('/api/hub/internal/transfer-status', 'alpha-token').send({ reference, status: 'Rejected' });
    expect((await M('CrossTransfer').findOne({ reference }).lean()).status).toBe('Rejected');

    // A finished shipment is not reopened by a late message.
    const done = ref('HT-DONE');
    await outbound({ reference: done, status: 'Released' });
    await asPartner('/api/hub/internal/transfer-status', 'alpha-token').send({ reference: done, status: 'Rejected' });
    expect((await M('CrossTransfer').findOne({ reference: done }).lean()).status).toBe('Released');
  });
});

describe('withdrawing a shipment', () => {
  it('the sender withdrawing closes it on our side, unless we already received it', async () => {
    const waiting = ref('HT-W');
    const got = ref('HT-G');
    await M('CrossTransfer').create({ businessType: 'log', direction: 'inbound', partnerSlug: 'alpha', itemName: 'A', unit: 'pcs', qtyBase: 1, reference: waiting, status: 'Pending' });
    await M('CrossTransfer').create({ businessType: 'log', direction: 'inbound', partnerSlug: 'alpha', itemName: 'B', unit: 'pcs', qtyBase: 1, reference: got, status: 'Received' });

    expect((await asPartner('/api/hub/internal/transfer-status', 'alpha-token').send({ reference: waiting, status: 'Cancelled' })).status).toBe(200);
    expect((await M('CrossTransfer').findOne({ reference: waiting }).lean()).status).toBe('Cancelled');

    expect((await asPartner('/api/hub/internal/transfer-status', 'alpha-token').send({ reference: got, status: 'Cancelled' })).status).toBe(409);
    expect((await M('CrossTransfer').findOne({ reference: got }).lean()).status).toBe('Received');
  });

  it('is refused here while the partner cannot be reached - it could still be received there', async () => {
    const reference = ref('HT-C');
    const t = await outbound({ reference });
    const res = await request(app).post(`/api/hub/transfers/${t._id}/cancel`).set(auth(superToken)).send({});
    expect(res.status).toBe(502);
    expect((await M('CrossTransfer').findById(t._id).lean()).status).toBe('Pending');
  });

  it('needs no agreement when the partner was never told about it', async () => {
    const t = await outbound({ reference: ref('HT-U'), partnerTodo: 'notify' });
    const res = await request(app).post(`/api/hub/transfers/${t._id}/cancel`).set(auth(superToken)).send({});
    expect(res.status).toBe(200);
    expect((await M('CrossTransfer').findById(t._id).lean()).status).toBe('Cancelled');
  });
});

describe('receiving into stock', () => {
  it('uses the item that already has that code instead of making a second one', async () => {
    const r = await request(app).post('/api/inventory').set(auth(superToken)).send({ itemName: 'Coded Here', unit: 'pcs', stockQty: 5, unitCost: 10, itemCode: 'CODE-77' });
    const existing = r.body.item._id;
    const t = await M('CrossTransfer').create({
      businessType: 'log', direction: 'inbound', partnerSlug: 'alpha', partnerName: 'Alpha',
      itemName: 'Coded There', unit: 'pcs', qtyBase: 5, unitCost: 10, itemCode: 'code-77', reference: ref('HT-CODE'), status: 'Pending',
    });
    const res = await request(app).post(`/api/hub/transfers/${t._id}/accept`).set(auth(superToken)).send({ createNew: true });
    expect(res.status).toBe(200);
    expect(String(res.body.transfer.targetItemId)).toBe(String(existing));
    expect((await M('Inventory').findById(existing).lean()).stockQty).toBe(10);
    expect(await M('Inventory').countDocuments({ itemCode: /^code-77$/i })).toBe(1);
  });

  it('a new item keeps the code it arrived with', async () => {
    const t = await M('CrossTransfer').create({
      businessType: 'log', direction: 'inbound', partnerSlug: 'alpha', partnerName: 'Alpha',
      itemName: 'Brand New Coded', unit: 'pcs', qtyBase: 3, unitCost: 7, itemCode: 'NEW-88', reference: ref('HT-NEW'), status: 'Pending',
    });
    await request(app).post(`/api/hub/transfers/${t._id}/accept`).set(auth(superToken)).send({ createNew: true });
    const made = await M('Inventory').findOne({ itemName: /^brand new coded$/i }).lean();
    expect(made.itemCode).toBe('NEW-88');
  });
});

describe('a transfer request between two businesses', () => {
  const file = (requestRef, token, body) => asPartner('/api/hub/internal/transfer-request-notify', token).send({
    requestRef, fromSlug: TENANT, fromName: TENANT, toSlug: 'alpha', toName: 'Alpha', filedBySlug: 'alpha',
    lines: [{ itemName: 'Widget', unit: 'pcs', qty: 10 }], requestedBy: 'Them', ...body,
  });
  const sync = (requestRef, token, body) => asPartner('/api/hub/internal/transfer-request-sync', token).send({ requestRef, ...body });
  const statusOf = async (requestRef) => (await M('TransferRequest').findOne({ requestRef }).lean())?.status;

  it('must be between the caller and us, and filed by the caller', async () => {
    const a = ref('TRQ-A');
    // alpha files one between itself and beta onto OUR list
    expect((await file(a, 'alpha-token', { fromSlug: 'beta', toSlug: 'alpha' })).status).toBe(403);
    // alpha files one that claims WE filed it
    expect((await file(a, 'alpha-token', { filedBySlug: TENANT })).status).toBe(403);
    expect(await M('TransferRequest').exists({ requestRef: a })).toBeNull();
    expect((await file(a, 'alpha-token', {})).status).toBe(200);
  });

  it('the business that asked cannot mark its own request approved', async () => {
    const r = ref('TRQ-B');
    await file(r, 'alpha-token', {});
    const res = await sync(r, 'alpha-token', { status: 'Approved', linkedShipmentRef: 'HT-FAKE' });
    expect(res.status).toBe(409);
    expect(await statusOf(r)).toBe('Pending');
  });

  it('nor change the quantities while it is our turn to answer', async () => {
    const r = ref('TRQ-C');
    await file(r, 'alpha-token', {});
    const res = await sync(r, 'alpha-token', { status: 'AwaitingFinal', lines: [{ itemName: 'Widget', unit: 'pcs', qty: 999 }] });
    expect(res.status).toBe(409);
    const doc = await M('TransferRequest').findOne({ requestRef: r }).lean();
    expect(doc.status).toBe('Pending');
    expect(doc.lines[0].qty).toBe(10);
  });

  it('but it can withdraw it, and saying so twice is fine', async () => {
    const r = ref('TRQ-D');
    await file(r, 'alpha-token', {});
    expect((await sync(r, 'alpha-token', { status: 'Cancelled' })).status).toBe(200);
    expect((await sync(r, 'alpha-token', { status: 'Cancelled' })).status).toBe(200);
    expect(await statusOf(r)).toBe('Cancelled');
    // ...and a finished request is not reopened.
    expect((await sync(r, 'alpha-token', { status: 'Pending' })).status).toBe(409);
  });

  it('filed while the partner is unreachable is remembered, to be sent again', async () => {
    const res = await request(app).post('/api/hub/transfer-requests').set(auth(superToken))
      .send({ partnerSlug: 'alpha', weAreAskingThemToSend: true, items: [{ itemName: 'Widget', unit: 'pcs', qty: 2 }] });
    expect(res.status).toBe(200);
    expect(res.body.warning).toMatch(/sent again automatically/);
    expect((await M('TransferRequest').findById(res.body.request._id).lean()).partnerSync).toBe('notify');
  });
});

describe('disconnecting', () => {
  it('the partner disconnecting stops its token working here', async () => {
    await M('LinkedBusiness').create({ businessType: 'log', role: 'client', partnerSlug: 'gamma', partnerName: 'Gamma', partnerUrl: 'http://unreachable.invalid', linkToken: 'gamma-token', status: 'active' });
    expect((await asPartner('/api/hub/internal/unlink', 'gamma-token').send({})).status).toBe(200);
    expect((await M('LinkedBusiness').findOne({ partnerSlug: 'gamma' }).lean()).status).toBe('suspended');
    expect((await asPartner('/api/hub/internal/transfer-notify', 'gamma-token').send({ shipmentRef: 'X', items: [] })).status).toBe(403);
  });
});
