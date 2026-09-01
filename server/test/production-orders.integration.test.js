// Production Orders - consuming raw materials from Inventory to create/add to
// a finished item, gated behind an approval step (production.approve).
//
// Two separate stages, mirroring Purchase Orders:
//   1. Approve - consumes materials only, flips fulfillmentStatus to
//      'Processing'. The output is NOT credited yet (yield isn't guaranteed).
//   2. Reconcile - someone types in the ACTUAL quantity produced; that's
//      what gets credited to inventory, and fulfillmentStatus becomes
//      Complete (met/beat the plan) or Partial (fell short).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, superTok, staffTok, mgrTok;
const auth = (m, p, t) => request(app)[m](p).set('Authorization', `Bearer ${t}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'prodSuper', role: 'superadmin' });
  await makeUser({ name: 'prodStaff', role: 'staff' });   // no production.approve
  await makeUser({ name: 'prodMgr', role: 'manager' });   // has production.approve by default
  superTok = await loginStaff(app, 'prodSuper');
  staffTok = await loginStaff(app, 'prodStaff');
  mgrTok = await loginStaff(app, 'prodMgr');
}, 120000);

afterAll(async () => { await ctx.stop(); });

async function makeMaterial({ name, stockQty = 100, unitCost = 10, unit = 'g' }) {
  return mongoose.model('Inventory').create({ itemName: name, stockQty, unit, unitCost, unitMultiplier: 1 });
}

// Files + approves in one step, for tests that only care about what comes
// after approval (reconciliation, ledger wiring, etc.).
async function fileAndApprove({ tok = staffTok, approver = mgrTok, materials, outputType, outputName, outputInvId, outputQty, outputUnit = 'g', outputPackSize } = {}) {
  const filed = await auth('post', '/api/production-orders', tok).send({
    materials, outputType, outputName, outputInvId, outputQty, outputUnit, outputPackSize,
  });
  const approved = await auth('post', `/api/production-orders/${filed.body.order._id}/approve`, approver).send({});
  return { filed, approved, orderId: filed.body.order._id };
}

describe('POST /api/production-orders - filing', () => {
  it('never touches stock - only the request is created', async () => {
    const mat = await makeMaterial({ name: 'PROD Green Beans A' });
    const res = await auth('post', '/api/production-orders', staffTok).send({
      materials: [{ invId: mat._id, qty: 10 }],
      outputType: 'new', outputName: 'Roasted Beans A', outputQty: 8, outputUnit: 'g',
    });
    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe('Pending');
    expect(res.body.order.fulfillmentStatus).toBeNull();
    const stillThere = await mongoose.model('Inventory').findById(mat._id).lean();
    expect(stillThere.stockQty).toBe(100);
  });

  it('rejects an order with no materials', async () => {
    const res = await auth('post', '/api/production-orders', staffTok).send({
      materials: [], outputType: 'new', outputName: 'X', outputQty: 1, outputUnit: 'g',
    });
    expect(res.status).toBe(400);
  });

  it('rejects a new output whose name collides with an existing item', async () => {
    const mat = await makeMaterial({ name: 'PROD Green Beans B' });
    await makeMaterial({ name: 'Roasted Beans B' });
    const res = await auth('post', '/api/production-orders', staffTok).send({
      materials: [{ invId: mat._id, qty: 5 }],
      outputType: 'new', outputName: 'Roasted Beans B', outputQty: 4, outputUnit: 'g',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already exists/i);
  });
});

describe('POST /api/production-orders/:id/approve - consumes materials only, does NOT credit output yet', () => {
  it('consumes the material and flips to Approved/Processing - no output item exists yet', async () => {
    const mat = await makeMaterial({ name: 'PROD Green Beans C', stockQty: 100, unitCost: 10 });
    const filed = await auth('post', '/api/production-orders', staffTok).send({
      materials: [{ invId: mat._id, qty: 20 }],  // 20 * ₱10 = ₱200 materials cost
      outputType: 'new', outputName: 'Roasted Beans C', outputQty: 16, outputUnit: 'g',
    });
    const orderId = filed.body.order._id;

    const res = await auth('post', `/api/production-orders/${orderId}/approve`, mgrTok).send({});
    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe('Approved');
    expect(res.body.order.fulfillmentStatus).toBe('Processing');
    expect(res.body.order.batchNumber).toMatch(/^PROD-/);
    expect(res.body.order.totalMaterialsCost).toBeCloseTo(200, 2);

    const material = await mongoose.model('Inventory').findById(mat._id).lean();
    expect(material.stockQty).toBe(80); // 100 - 20

    const noOutputYet = await mongoose.model('Inventory').findOne({ itemName: 'ROASTED BEANS C' }).lean();
    expect(noOutputYet).toBeNull(); // not created until reconciliation

    const cards = await mongoose.model('StockCard').find({ reference: res.body.order.batchNumber }).lean();
    expect(cards).toHaveLength(1);
    expect(cards[0].type).toBe('Production Consumption');
    expect(cards[0].qtyChange).toBe(-20);
  });

  it('blocks approval by someone without production.approve', async () => {
    const mat = await makeMaterial({ name: 'PROD Green Beans D' });
    const filed = await auth('post', '/api/production-orders', staffTok).send({
      materials: [{ invId: mat._id, qty: 5 }],
      outputType: 'new', outputName: 'Roasted Beans D', outputQty: 4, outputUnit: 'g',
    });
    const res = await auth('post', `/api/production-orders/${filed.body.order._id}/approve`, staffTok).send({});
    expect(res.status).toBe(403);
  });

  it('refuses to approve when materials are no longer sufficient, and leaves everything untouched', async () => {
    const mat = await makeMaterial({ name: 'PROD Green Beans E', stockQty: 10 });
    const filed = await auth('post', '/api/production-orders', staffTok).send({
      materials: [{ invId: mat._id, qty: 8 }],
      outputType: 'new', outputName: 'Roasted Beans E', outputQty: 6, outputUnit: 'g',
    });
    // Stock drops below what the order needs, between filing and approval.
    await mongoose.model('Inventory').updateOne({ _id: mat._id }, { $set: { stockQty: 3 } });

    const res = await auth('post', `/api/production-orders/${filed.body.order._id}/approve`, mgrTok).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not enough/i);

    const order = await mongoose.model('ProductionOrder').findById(filed.body.order._id).lean();
    expect(order.status).toBe('Pending'); // unchanged
    const material = await mongoose.model('Inventory').findById(mat._id).lean();
    expect(material.stockQty).toBe(3); // unchanged
  });

  it('cannot approve the same order twice', async () => {
    const mat = await makeMaterial({ name: 'PROD Green Beans F', stockQty: 50 });
    const filed = await auth('post', '/api/production-orders', staffTok).send({
      materials: [{ invId: mat._id, qty: 5 }],
      outputType: 'new', outputName: 'Roasted Beans F', outputQty: 4, outputUnit: 'g',
    });
    const id = filed.body.order._id;
    expect((await auth('post', `/api/production-orders/${id}/approve`, mgrTok).send({})).status).toBe(200);
    const again = await auth('post', `/api/production-orders/${id}/approve`, mgrTok).send({});
    expect(again.status).toBe(409);
  });
});

describe('POST /api/production-orders/:id/reconcile - the manual "actual output qty" step', () => {
  it('cannot reconcile a Pending (not yet approved) order', async () => {
    const mat = await makeMaterial({ name: 'PROD Green Beans N' });
    const filed = await auth('post', '/api/production-orders', staffTok).send({
      materials: [{ invId: mat._id, qty: 5 }],
      outputType: 'new', outputName: 'Roasted Beans N', outputQty: 4, outputUnit: 'g',
    });
    const res = await auth('post', `/api/production-orders/${filed.body.order._id}/reconcile`, mgrTok).send({ actualOutputQty: 4 });
    expect(res.status).toBe(409);
  });

  it('requires a positive actualOutputQty', async () => {
    const mat = await makeMaterial({ name: 'PROD Green Beans O', stockQty: 50, unitCost: 10 });
    const { orderId } = await fileAndApprove({ materials: [{ invId: mat._id, qty: 20 }], outputType: 'new', outputName: 'Roasted Beans O', outputQty: 16 });
    const res = await auth('post', `/api/production-orders/${orderId}/reconcile`, mgrTok).send({ actualOutputQty: 0 });
    expect(res.status).toBe(400);
  });

  it('meeting or beating the planned quantity marks the batch Complete, credits the output at that ACTUAL qty', async () => {
    const mat = await makeMaterial({ name: 'PROD Green Beans P', stockQty: 100, unitCost: 10 });
    const { orderId } = await fileAndApprove({ materials: [{ invId: mat._id, qty: 20 }], outputType: 'new', outputName: 'Roasted Beans P', outputQty: 16 });

    const res = await auth('post', `/api/production-orders/${orderId}/reconcile`, mgrTok).send({ actualOutputQty: 18 }); // beat the plan
    expect(res.status).toBe(200);
    expect(res.body.order.fulfillmentStatus).toBe('Complete');
    expect(res.body.order.actualOutputQty).toBe(18);

    const output = await mongoose.model('Inventory').findById(res.body.outputItem._id).lean();
    expect(output.itemName).toBe('ROASTED BEANS P');
    expect(output.stockQty).toBe(18); // the ACTUAL qty, not the planned 16
    expect(output.unitCost).toBeCloseTo(200 / 18, 4); // materials cost / ACTUAL qty
    expect(output.expiryBatches).toHaveLength(1);
    expect(output.expiryBatches[0].reference).toBe(res.body.order.batchNumber);

    const outputCard = await mongoose.model('StockCard').findOne({ reference: res.body.order.batchNumber, type: 'Production Output' }).lean();
    expect(outputCard.qtyChange).toBe(18);
  });

  it('falling short of the planned quantity marks the batch Partial', async () => {
    const mat = await makeMaterial({ name: 'PROD Green Beans Q', stockQty: 100, unitCost: 10 });
    const { orderId } = await fileAndApprove({ materials: [{ invId: mat._id, qty: 20 }], outputType: 'new', outputName: 'Roasted Beans Q', outputQty: 16 });

    const res = await auth('post', `/api/production-orders/${orderId}/reconcile`, mgrTok).send({ actualOutputQty: 10 }); // short of 16
    expect(res.status).toBe(200);
    expect(res.body.order.fulfillmentStatus).toBe('Partial');

    const output = await mongoose.model('Inventory').findById(res.body.outputItem._id).lean();
    expect(output.stockQty).toBe(10);
    expect(output.unitCost).toBeCloseTo(200 / 10, 4); // fewer units, same total cost -> higher unit cost
  });

  it('cannot reconcile the same order twice', async () => {
    const mat = await makeMaterial({ name: 'PROD Green Beans R', stockQty: 100, unitCost: 10 });
    const { orderId } = await fileAndApprove({ materials: [{ invId: mat._id, qty: 20 }], outputType: 'new', outputName: 'Roasted Beans R', outputQty: 16 });
    expect((await auth('post', `/api/production-orders/${orderId}/reconcile`, mgrTok).send({ actualOutputQty: 16 })).status).toBe(200);
    const again = await auth('post', `/api/production-orders/${orderId}/reconcile`, mgrTok).send({ actualOutputQty: 16 });
    expect(again.status).toBe(409);
  });

  it('adds to an EXISTING output item at the actual qty, blending the weighted-average cost', async () => {
    const mat = await makeMaterial({ name: 'PROD Green Beans S', stockQty: 100, unitCost: 10 });
    // Existing output already has 10 units at ₱5 each = ₱50 total value.
    const outItem = await mongoose.model('Inventory').create({ itemName: 'Roasted Beans S', stockQty: 10, unit: 'g', unitCost: 5, unitMultiplier: 1 });
    const { orderId } = await fileAndApprove({ materials: [{ invId: mat._id, qty: 20 }], outputType: 'existing', outputInvId: outItem._id, outputQty: 16 });

    const res = await auth('post', `/api/production-orders/${orderId}/reconcile`, superTok).send({ actualOutputQty: 16 }); // met the plan exactly
    expect(res.status).toBe(200);
    expect(res.body.order.fulfillmentStatus).toBe('Complete');

    const output = await mongoose.model('Inventory').findById(outItem._id).lean();
    expect(output.stockQty).toBe(26); // 10 + 16
    expect(output.unitCost).toBeCloseTo(250 / 26, 3); // (50 existing + 200 added) / 26
  });

  it('is wired into the Ledger at reconcile time, not at approval', async () => {
    const mat = await makeMaterial({ name: 'PROD Green Beans T', stockQty: 100, unitCost: 10 });
    const { orderId, approved } = await fileAndApprove({ materials: [{ invId: mat._id, qty: 20 }], outputType: 'new', outputName: 'Roasted Beans T', outputQty: 16 });
    const batchNumber = approved.body.order.batchNumber;

    expect(await mongoose.model('JournalEntry').findOne({ reference: batchNumber }).lean()).toBeNull(); // nothing yet

    const res = await auth('post', `/api/production-orders/${orderId}/reconcile`, mgrTok).send({ actualOutputQty: 16 });
    expect(res.status).toBe(200);

    const je = await mongoose.model('JournalEntry').findOne({ reference: batchNumber }).lean();
    expect(je).toBeTruthy();
    expect(je.totalDebit).toBeCloseTo(200, 2);
    expect(je.totalCredit).toBeCloseTo(200, 2);
    expect(je.lines.every(l => l.accountCode === '130000')).toBe(true);
    const netOnAccount = je.lines.reduce((s, l) => s + l.debit - l.credit, 0);
    expect(netOnAccount).toBeCloseTo(0, 6);
  });

  it('posts nothing when the materials carried no cost (unitCost 0)', async () => {
    const mat = await makeMaterial({ name: 'PROD Green Beans U', stockQty: 100, unitCost: 0 });
    const { orderId, approved } = await fileAndApprove({ materials: [{ invId: mat._id, qty: 20 }], outputType: 'new', outputName: 'Roasted Beans U', outputQty: 16 });
    await auth('post', `/api/production-orders/${orderId}/reconcile`, mgrTok).send({ actualOutputQty: 16 });
    const je = await mongoose.model('JournalEntry').findOne({ reference: approved.body.order.batchNumber }).lean();
    expect(je).toBeNull();
  });
});

describe('POST /api/production-orders/:id/reject', () => {
  it('leaves stock untouched and requires a reason', async () => {
    const mat = await makeMaterial({ name: 'PROD Green Beans H' });
    const filed = await auth('post', '/api/production-orders', staffTok).send({
      materials: [{ invId: mat._id, qty: 5 }],
      outputType: 'new', outputName: 'Roasted Beans H', outputQty: 4, outputUnit: 'g',
    });
    const noReason = await auth('post', `/api/production-orders/${filed.body.order._id}/reject`, mgrTok).send({});
    expect(noReason.status).toBe(400);

    const res = await auth('post', `/api/production-orders/${filed.body.order._id}/reject`, mgrTok).send({ reason: 'wrong ratio' });
    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe('Rejected');

    const material = await mongoose.model('Inventory').findById(mat._id).lean();
    expect(material.stockQty).toBe(100);
  });
});

describe('pieces convention - materials are stored/consumed in whatever base-unit qty the client sends (already piece-converted)', () => {
  it('a "1 piece = 377g" material is consumed for exactly the base quantity filed, not re-derived server-side', async () => {
    // Simulates the client having already converted "2 pcs" of a 377g-per-
    // piece item into 754 base units before filing - the server trusts that
    // number as-is (see production.js's comment on why: pack-size parsing
    // only exists client-side).
    const mat = await mongoose.model('Inventory').create({
      itemName: 'PROD Condensed Milk 377G', stockQty: 5000, unit: 'g', unitCost: 0.175, unitMultiplier: 1, packSize: 377,
    });
    const filed = await auth('post', '/api/production-orders', staffTok).send({
      materials: [{ invId: mat._id, qty: 754 }], // 2 pcs * 377g
      outputType: 'new', outputName: 'Roasted Beans L', outputQty: 100, outputUnit: 'g',
    });
    const res = await auth('post', `/api/production-orders/${filed.body.order._id}/approve`, mgrTok).send({});
    expect(res.status).toBe(200);
    const material = await mongoose.model('Inventory').findById(mat._id).lean();
    expect(material.stockQty).toBe(5000 - 754);
  });

  it('a new output item can be given a pack size so future productions can also be counted in pieces', async () => {
    const mat = await makeMaterial({ name: 'PROD Green Beans M', stockQty: 1000 });
    const { orderId } = await fileAndApprove({ materials: [{ invId: mat._id, qty: 100 }], outputType: 'new', outputName: 'Roasted Beans M', outputQty: 80, outputPackSize: 250 });
    const res = await auth('post', `/api/production-orders/${orderId}/reconcile`, mgrTok).send({ actualOutputQty: 80 });
    expect(res.status).toBe(200);
    const output = await mongoose.model('Inventory').findById(res.body.outputItem._id).lean();
    expect(output.packSize).toBe(250);
  });
});

describe('GET /api/production-orders - scoping and fulfillmentStatus filter', () => {
  it('a plain staff member only sees their own; an approver sees everything', async () => {
    const mat = await makeMaterial({ name: 'PROD Green Beans I' });
    await auth('post', '/api/production-orders', staffTok).send({
      materials: [{ invId: mat._id, qty: 1 }],
      outputType: 'new', outputName: 'Roasted Beans I', outputQty: 1, outputUnit: 'g',
    });

    const mine = await auth('get', '/api/production-orders', staffTok);
    expect(mine.body.orders.every(o => o.requestedBy === 'prodStaff')).toBe(true);

    const all = await auth('get', '/api/production-orders', mgrTok);
    expect(all.body.orders.some(o => o.requestedBy === 'prodStaff')).toBe(true);
  });

  it('filters by fulfillmentStatus once approved/reconciled', async () => {
    const mat = await makeMaterial({ name: 'PROD Green Beans V', stockQty: 100, unitCost: 10 });
    const { orderId } = await fileAndApprove({ materials: [{ invId: mat._id, qty: 20 }], outputType: 'new', outputName: 'Roasted Beans V', outputQty: 16 });

    const processing = await auth('get', '/api/production-orders?fulfillmentStatus=Processing', mgrTok);
    expect(processing.body.orders.some(o => o._id === orderId)).toBe(true);

    await auth('post', `/api/production-orders/${orderId}/reconcile`, mgrTok).send({ actualOutputQty: 16 });

    const complete = await auth('get', '/api/production-orders?fulfillmentStatus=Complete', mgrTok);
    expect(complete.body.orders.some(o => o._id === orderId)).toBe(true);
    const stillProcessing = await auth('get', '/api/production-orders?fulfillmentStatus=Processing', mgrTok);
    expect(stillProcessing.body.orders.some(o => o._id === orderId)).toBe(false);
  });
});
