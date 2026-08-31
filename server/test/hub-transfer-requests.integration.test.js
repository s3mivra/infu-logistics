// Hub Transfer Requests - negotiated stock asks between businesses, distinct
// from the plain "New Transfer" (Send) flow which is always us pushing stock
// we already have. Either business can initiate an ask; the other side can
// decline, accept it exactly as asked, or counter with what they can actually
// give - fixed at one counter round, per the state machine on
// TransferRequestSchema (server.js) and the routes in hub.js.
//
// A single test process can only ever authenticate as ONE tenant, so calls
// the PARTNER's server would make to ours are simulated the same way the real
// partner would make them: POSTs to our /api/hub/internal/... routes,
// authenticated with x-link-token (requireLinkToken), not a JWT. That is
// genuinely how cross-tenant sync works in production - nothing here is a
// shortcut around the real mechanism.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, superTok, item;
const auth = (m, p, t) => request(app)[m](p).set('Authorization', `Bearer ${t}`);
const asPartner = (p, token) => request(app).post(p).set('x-link-token', token);

const TENANT = 'unknown'; // MONGO_URI in tests has no /semivra_<slug> segment, so hub.js's TENANT constant falls back to this

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'htrSuper', role: 'superadmin' });
  superTok = await loginStaff(app, 'htrSuper');

  await mongoose.model('LinkedBusiness').create({
    businessType: 'log', role: 'client', partnerSlug: 'other-biz', partnerName: 'Other Biz',
    partnerUrl: 'http://unreachable.invalid', linkToken: 'other-biz-token', status: 'active',
  });

  const invRes = await auth('post', '/api/inventory', superTok)
    .send({ itemName: 'Negotiated Widget', unit: 'pcs', stockQty: 500, unitCost: 10 });
  item = invRes.body.item;
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('filing an ask', () => {
  it('creates our own copy as "filed", Pending, round 1', async () => {
    const res = await auth('post', '/api/hub/transfer-requests', superTok).send({
      partnerSlug: 'other-biz',
      weAreAskingThemToSend: true, // fromSlug=other-biz (they'd ship), toSlug=us
      items: [{ itemName: 'Their Widget', unit: 'pcs', qty: 50, note: 'need it by Friday' }],
    });
    expect(res.status).toBe(200);
    expect(res.body.request.side).toBe('filed');
    expect(res.body.request.status).toBe('Pending');
    expect(res.body.request.round).toBe(1);
    expect(res.body.request.fromSlug).toBe('other-biz');
    expect(res.body.request.toSlug).toBe(TENANT);
    // Partner is unreachable in this test, so notifying them fails - but the
    // ask is still filed on our side; a warning is surfaced, not an error.
    expect(res.body.warning).toBeTruthy();
  });

  it('rejects a request with no valid line items', async () => {
    const res = await auth('post', '/api/hub/transfer-requests', superTok).send({
      partnerSlug: 'other-biz', items: [{ itemName: '', qty: 0 }],
    });
    expect(res.status).toBe(400);
  });
});

describe('someone else asking US to fulfill', () => {
  // Simulates what our server would look like after `other-biz` files an ask
  // against us, by POSTing to the same internal route their server would hit.
  async function fileAskAgainstUs(qty = 50) {
    const requestRef = `TRQ-TEST-${Math.random().toString(36).slice(2, 8)}`;
    const res = await asPartner('/api/hub/internal/transfer-request-notify', 'other-biz-token').send({
      requestRef,
      fromSlug: TENANT, fromName: TENANT,       // we would ship
      toSlug: 'other-biz', toName: 'Other Biz', // they would receive
      filedBySlug: 'other-biz',
      lines: [{ itemId: String(item._id), itemName: item.itemName, unit: item.unit, qty, note: '' }],
      requestedBy: 'Their Staffer',
    });
    expect(res.status).toBe(200);
    const doc = await mongoose.model('TransferRequest').findOne({ requestRef, side: 'received' }).lean();
    expect(doc).toBeTruthy();
    return doc;
  }

  it('lands on our side as "received", awaiting OUR response', async () => {
    const doc = await fileAskAgainstUs();
    const list = await auth('get', '/api/hub/transfer-requests', superTok);
    expect(list.body.requests.some(r => String(r._id) === String(doc._id) && r.side === 'received')).toBe(true);
  });

  it('we can decline it, with a reason', async () => {
    const doc = await fileAskAgainstUs();
    const res = await auth('post', `/api/hub/transfer-requests/${doc._id}/decline`, superTok)
      .send({ reason: 'Not enough stock to spare this month.' });
    expect(res.status).toBe(200);
    expect(res.body.request.status).toBe('Declined');
    expect(res.body.request.history.at(-1)).toMatchObject({ action: 'declined', note: 'Not enough stock to spare this month.' });
  });

  it('we can approve the original ask exactly as-is, which creates the shipment directly', async () => {
    const doc = await fileAskAgainstUs(30);
    const res = await auth('post', `/api/hub/transfer-requests/${doc._id}/approve-as-is`, superTok).send({});
    expect(res.status).toBe(200);
    expect(res.body.request.status).toBe('Approved');
    expect(res.body.shipmentRef).toBeTruthy();
    expect(res.body.transfers).toHaveLength(1);
    expect(res.body.transfers[0].qtyBase).toBe(30);
    expect(res.body.transfers[0].status).toBe('Pending'); // already agreed - skips the internal pre-approval queue
  });

  it('refuses to approve as-is once it is no longer Pending', async () => {
    const doc = await fileAskAgainstUs();
    await auth('post', `/api/hub/transfer-requests/${doc._id}/decline`, superTok).send({ reason: 'x' });
    const res = await auth('post', `/api/hub/transfer-requests/${doc._id}/approve-as-is`, superTok).send({});
    expect(res.status).toBe(409);
  });

  it('we can counter with a smaller quantity, which moves to CounterPending, round 2', async () => {
    const doc = await fileAskAgainstUs(200); // more than we want to give
    const res = await auth('post', `/api/hub/transfer-requests/${doc._id}/counter`, superTok).send({
      lines: [{ itemId: String(item._id), itemName: item.itemName, unit: item.unit, qty: 80 }],
      note: 'Can only spare 80 this time.',
    });
    expect(res.status).toBe(200);
    expect(res.body.request.status).toBe('CounterPending');
    expect(res.body.request.round).toBe(2);
    expect(res.body.request.lines[0].qty).toBe(80);
    // The original ask is preserved for the history/audit trail.
    expect(res.body.request.originalLines[0].qty).toBe(200);
  });

  it('cannot counter a request that is not Pending', async () => {
    const doc = await fileAskAgainstUs();
    await auth('post', `/api/hub/transfer-requests/${doc._id}/decline`, superTok).send({ reason: 'x' });
    const res = await auth('post', `/api/hub/transfer-requests/${doc._id}/counter`, superTok)
      .send({ lines: [{ itemId: String(item._id), itemName: item.itemName, unit: item.unit, qty: 1 }] });
    expect(res.status).toBe(409);
  });

  it('the ORIGINAL requester cannot be impersonated by us to accept our own counter', async () => {
    // accept-counter can only be done by whoever FILED the ask - here that is
    // 'other-biz', not us. Our own token must never be able to act as them.
    const doc = await fileAskAgainstUs(200);
    await auth('post', `/api/hub/transfer-requests/${doc._id}/counter`, superTok)
      .send({ lines: [{ itemId: String(item._id), itemName: item.itemName, unit: item.unit, qty: 80 }] });

    const res = await auth('post', `/api/hub/transfer-requests/${doc._id}/accept-counter`, superTok).send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/not your turn/i);
  });

  it('once the requester accepts (synced from their side), it moves to AwaitingFinal for us to finalize', async () => {
    const doc = await fileAskAgainstUs(200);
    await auth('post', `/api/hub/transfer-requests/${doc._id}/counter`, superTok)
      .send({ lines: [{ itemId: String(item._id), itemName: item.itemName, unit: item.unit, qty: 60 }] });

    // Simulates other-biz's server calling us back after THEY accepted the
    // counter on their own copy - the same internal sync route their server
    // would actually hit.
    const sync = await asPartner('/api/hub/internal/transfer-request-sync', 'other-biz-token').send({
      requestRef: doc.requestRef, status: 'AwaitingFinal',
      lines: [{ itemId: String(item._id), itemName: item.itemName, unit: item.unit, qty: 60 }],
      round: 2, respondedBy: 'Their Staffer',
    });
    expect(sync.status).toBe(200);

    const res = await auth('post', `/api/hub/transfer-requests/${doc._id}/finalize`, superTok).send({});
    expect(res.status).toBe(200);
    expect(res.body.request.status).toBe('Approved');
    expect(res.body.transfers[0].qtyBase).toBe(60); // the NEGOTIATED quantity, not the original 200
  });

  it('finalize refuses to overcommit stock the negotiation promised but we no longer have', async () => {
    const scarce = await auth('post', '/api/inventory', superTok)
      .send({ itemName: 'Scarce Widget', unit: 'pcs', stockQty: 5, unitCost: 1 });
    const requestRef = `TRQ-SCARCE-${Math.random().toString(36).slice(2, 8)}`;
    await asPartner('/api/hub/internal/transfer-request-notify', 'other-biz-token').send({
      requestRef, fromSlug: TENANT, fromName: TENANT, toSlug: 'other-biz', toName: 'Other Biz',
      filedBySlug: 'other-biz',
      lines: [{ itemId: String(scarce.body.item._id), itemName: 'Scarce Widget', unit: 'pcs', qty: 999 }],
      requestedBy: 'Their Staffer',
    });
    const doc = await mongoose.model('TransferRequest').findOne({ requestRef, side: 'received' }).lean();

    const res = await auth('post', `/api/hub/transfer-requests/${doc._id}/approve-as-is`, superTok).send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/only 5pcs on hand/i);
  });
});

describe('withdrawing our own filed ask', () => {
  it('can only be cancelled while nobody has responded yet', async () => {
    const filed = await auth('post', '/api/hub/transfer-requests', superTok).send({
      partnerSlug: 'other-biz', weAreAskingThemToSend: true,
      items: [{ itemName: 'Withdrawable Widget', unit: 'pcs', qty: 10 }],
    });
    const id = filed.body.request._id;

    const cancelled = await auth('post', `/api/hub/transfer-requests/${id}/cancel`, superTok).send({});
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.request.status).toBe('Cancelled');

    const again = await auth('post', `/api/hub/transfer-requests/${id}/cancel`, superTok).send({});
    expect(again.status).toBe(409);
  });

  it('cannot be withdrawn by anyone other than whoever filed it', async () => {
    const requestRef = `TRQ-NOTMINE-${Math.random().toString(36).slice(2, 8)}`;
    await asPartner('/api/hub/internal/transfer-request-notify', 'other-biz-token').send({
      requestRef, fromSlug: TENANT, fromName: TENANT, toSlug: 'other-biz', toName: 'Other Biz',
      filedBySlug: 'other-biz', // THEY filed it, not us
      lines: [{ itemId: String(item._id), itemName: item.itemName, unit: item.unit, qty: 5 }],
      requestedBy: 'Their Staffer',
    });
    const doc = await mongoose.model('TransferRequest').findOne({ requestRef, side: 'received' }).lean();

    const res = await auth('post', `/api/hub/transfer-requests/${doc._id}/cancel`, superTok).send({});
    expect(res.status).toBe(403);
  });
});
