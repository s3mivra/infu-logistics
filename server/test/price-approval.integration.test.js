// Price changes go through an approval gate.
//
// The rule: a selling price or recipe cost edited by someone WITHOUT
// pricing.approve is held as a request and does not reach the catalogue. The
// rest of the same edit still saves - a typo fix must not be stuck behind a
// price review. Someone WITH the permission is the person who would sign it
// off anyway, so they write straight through.
//
// The case that matters most is the one that looks like a success: an edit
// that returns 200 while the price it contained was quietly held. If the
// response didn't say so, the user would believe the price had changed.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, superTok, mgrTok, prod;
const auth = (m, p, t) => request(app)[m](p).set('Authorization', `Bearer ${t}`);
const Product = () => mongoose.model('Product');
const ChangeRequest = () => mongoose.model('ChangeRequest');

// The Pricing tab always sends a reason; the server stores it on the request.
const editPrice = (tok, id, body, reason = 'Supplier increase') =>
  auth('put', `/api/products/${id}`, tok)
    .set('X-Change-Reason', encodeURIComponent(reason))
    .send(body);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'papSuper', role: 'superadmin' });
  // manager holds products.manage but NOT pricing.approve - the gated case.
  await makeUser({ name: 'papMgr', role: 'manager' });
  superTok = await loginStaff(app, 'papSuper');
  mgrTok = await loginStaff(app, 'papMgr');

  await mongoose.model('Category').create({ name: 'PapCat', department: 'Logistics' });
}, 120000);

afterAll(async () => { await ctx.stop(); });

beforeEach(async () => {
  prod = await Product().create({ name: `Widget ${Math.random().toString(36).slice(2, 7)}`, category: 'PapCat', basePrice: 250 });
});

describe('a price edit without approval rights', () => {
  it('does NOT change the price, and says so', async () => {
    const res = await editPrice(mgrTok, prod._id, { basePrice: 300 });
    expect(res.status).toBe(200);
    // The tell: a 200 that reports what it held back.
    expect(res.body.pendingApproval).toHaveLength(1);
    expect(res.body.pendingApproval[0]).toMatchObject({ field: 'basePrice', oldValue: 250, newValue: 300 });

    const after = await Product().findById(prod._id).lean();
    expect(after.basePrice).toBe(250);      // unchanged - the whole point
  });

  it('still saves the non-price parts of the same edit', async () => {
    const res = await editPrice(mgrTok, prod._id, { basePrice: 300, name: 'Renamed Widget' });
    expect(res.status).toBe(200);

    const after = await Product().findById(prod._id).lean();
    expect(after.name).toBe('Renamed Widget');   // applied
    expect(after.basePrice).toBe(250);           // held
  });

  it('files a request carrying who asked and why', async () => {
    await editPrice(mgrTok, prod._id, { basePrice: 300 }, 'Fuel surcharge');
    const cr = await ChangeRequest().findOne({ entityId: String(prod._id) }).lean();
    expect(cr.status).toBe('Pending');
    expect(cr.requestedBy).toBe('papMgr');
    expect(cr.reason).toBe('Fuel surcharge');
    expect(cr.changes[0].label).toBe('Selling price');
  });

  it('opens no request when the price was not actually changed', async () => {
    // Forms resubmit every field; a no-op must not fill the queue.
    const res = await editPrice(mgrTok, prod._id, { basePrice: 250, name: 'Same Price' });
    expect(res.body.pendingApproval).toBeUndefined();
    expect(await ChangeRequest().countDocuments({ entityId: String(prod._id) })).toBe(0);
  });

  it('writes no price-history row for a change that never happened', async () => {
    await editPrice(mgrTok, prod._id, { basePrice: 300 });
    const hist = await auth('get', `/api/products/${prod._id}/price-history`, superTok);
    expect(hist.body.history).toHaveLength(0);
    // ...but it IS visible as pending, so the edit doesn't look lost.
    expect(hist.body.pending).toHaveLength(1);
    expect(hist.body.pending[0].requestedBy).toBe('papMgr');
  });
});

describe('a price edit by an approver', () => {
  it('applies immediately with no request filed', async () => {
    const res = await editPrice(superTok, prod._id, { basePrice: 300 });
    expect(res.status).toBe(200);
    expect(res.body.pendingApproval).toBeUndefined();

    const after = await Product().findById(prod._id).lean();
    expect(after.basePrice).toBe(300);
    expect(await ChangeRequest().countDocuments({ entityId: String(prod._id) })).toBe(0);
  });

  it('still lands in price history', async () => {
    await editPrice(superTok, prod._id, { basePrice: 300 }, 'Direct change');
    const hist = await auth('get', `/api/products/${prod._id}/price-history`, superTok);
    expect(hist.body.history[0]).toMatchObject({ type: 'price', oldValue: 250, newValue: 300, viaApproval: false });
  });
});

describe('approving a request', () => {
  it('applies the held price and records both names', async () => {
    await editPrice(mgrTok, prod._id, { basePrice: 300 });
    const cr = await ChangeRequest().findOne({ entityId: String(prod._id) }).lean();

    const res = await auth('post', `/api/change-requests/${cr._id}/approve`, superTok).send({});
    expect(res.status).toBe(200);

    const after = await Product().findById(prod._id).lean();
    expect(after.basePrice).toBe(300);

    const hist = await auth('get', `/api/products/${prod._id}/price-history`, superTok);
    // Who asked and who allowed it - the pair is the point of the gate.
    expect(hist.body.history[0]).toMatchObject({
      viaApproval: true, requestedBy: 'papMgr', approvedBy: 'papSuper', newValue: 300,
    });
  });

  it('refuses to overwrite a price that moved after the request was filed', async () => {
    await editPrice(mgrTok, prod._id, { basePrice: 300 });
    const cr = await ChangeRequest().findOne({ entityId: String(prod._id) }).lean();

    // Someone corrects the price by another route in the meantime.
    await editPrice(superTok, prod._id, { basePrice: 275 });

    const res = await auth('post', `/api/change-requests/${cr._id}/approve`, superTok).send({});
    expect(res.status).toBe(409);
    // The approver agreed to 250 -> 300, not to 275 -> 300.
    expect(res.body.conflicts[0]).toMatchObject({ expected: 250, current: 275, requested: 300 });

    const after = await Product().findById(prod._id).lean();
    expect(after.basePrice).toBe(275);     // untouched by the stale approval
  });

  it('cannot be approved twice', async () => {
    await editPrice(mgrTok, prod._id, { basePrice: 300 });
    const cr = await ChangeRequest().findOne({ entityId: String(prod._id) }).lean();
    expect((await auth('post', `/api/change-requests/${cr._id}/approve`, superTok).send({})).status).toBe(200);
    const again = await auth('post', `/api/change-requests/${cr._id}/approve`, superTok).send({});
    expect(again.status).toBe(400);
    expect(again.body.error).toMatch(/already Approved/i);
  });

  it('is refused to someone without the permission', async () => {
    await editPrice(mgrTok, prod._id, { basePrice: 300 });
    const cr = await ChangeRequest().findOne({ entityId: String(prod._id) }).lean();
    const res = await auth('post', `/api/change-requests/${cr._id}/approve`, mgrTok).send({});
    expect(res.status).toBe(403);
    expect((await Product().findById(prod._id).lean()).basePrice).toBe(250);
  });
});

describe('rejecting a request', () => {
  it('leaves the price alone and records why', async () => {
    await editPrice(mgrTok, prod._id, { basePrice: 300 });
    const cr = await ChangeRequest().findOne({ entityId: String(prod._id) }).lean();

    const res = await auth('post', `/api/change-requests/${cr._id}/reject`, superTok)
      .send({ reason: 'Wait for the new supplier quote' });
    expect(res.status).toBe(200);

    expect((await Product().findById(prod._id).lean()).basePrice).toBe(250);
    const after = await ChangeRequest().findById(cr._id).lean();
    expect(after.status).toBe('Rejected');
    expect(after.rejectionReason).toMatch(/supplier quote/);
  });
});

describe('the queue', () => {
  it('shows a requester only their own, and an approver everything', async () => {
    await editPrice(mgrTok, prod._id, { basePrice: 300 });

    const mine = await auth('get', '/api/change-requests?status=Pending', mgrTok);
    expect(mine.body.canApprove).toBe(false);
    expect(mine.body.requests.every(r => r.requestedBy === 'papMgr')).toBe(true);

    const all = await auth('get', '/api/change-requests?status=Pending', superTok);
    expect(all.body.canApprove).toBe(true);
    expect(all.body.requests.length).toBeGreaterThanOrEqual(1);
  });

  it('lets a requester withdraw their own', async () => {
    await editPrice(mgrTok, prod._id, { basePrice: 300 });
    const cr = await ChangeRequest().findOne({ entityId: String(prod._id), status: 'Pending' }).lean();
    const res = await auth('post', `/api/change-requests/${cr._id}/withdraw`, mgrTok).send({});
    expect(res.status).toBe(200);
    expect((await ChangeRequest().findById(cr._id).lean()).rejectionReason).toMatch(/withdrawn/i);
  });
});

describe('the price change log', () => {
  it('reports every change with who made it and whether it was reviewed', async () => {
    await editPrice(superTok, prod._id, { basePrice: 400 }, 'Direct');
    await editPrice(mgrTok, prod._id, { basePrice: 500 }, 'Requested');
    const cr = await ChangeRequest().findOne({ entityId: String(prod._id), status: 'Pending' }).lean();
    await auth('post', `/api/change-requests/${cr._id}/approve`, superTok).send({});

    const res = await auth('get', '/api/reports/price-changes', superTok);
    expect(res.status).toBe(200);

    const mine = res.body.changes.filter(c => c.productId === String(prod._id));
    expect(mine).toHaveLength(2);
    // 250 -> 400 direct, then 400 -> 500 through the queue.
    expect(mine.find(c => c.newValue === 500)).toMatchObject({ viaApproval: true, approvedBy: 'papSuper', requestedBy: 'papMgr' });
    expect(mine.find(c => c.newValue === 400)).toMatchObject({ viaApproval: false, changedBy: 'papSuper' });
    // 400 -> 500 is a 25% move.
    expect(mine.find(c => c.newValue === 500).percent).toBe(25);
    expect(res.body.summary.priceChanges).toBeGreaterThanOrEqual(2);
  });
});
