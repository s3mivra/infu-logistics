// Purchase Order workflow integration tests - draft → status → receive/reconcile.
// Receiving a line linked to a real Inventory item (invId set) posts straight to
// stock (WAC costing) + a journal entry; unlinked lines stay PO-only tracking.
// Receiving is repeatable until every line is fully received (Incomplete is not
// terminal) - a short delivery can be reopened later for just the outstanding qty.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let app, stop, superToken, managerToken, cashierToken;

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'log', jwtSecret: 'po-test-secret-0123456789' }));
  await makeUser({ name: 'PoBoss', role: 'superadmin', password: 'pw' });
  await makeUser({ name: 'PoManager', role: 'manager', password: 'pw' });   // procurement.view + manage (not delete)
  await makeUser({ name: 'PoCashier', role: 'cashier', password: 'pw' });   // procurement.view only
  // The multi-tenancy Phase-1 boot backfill races with makeUser in the harness,
  // leaving test users with inconsistent tenantIds. Normalize to a single shared
  // tenant BEFORE login so tokens carry a uniform scope (mirrors single-tenant prod).
  await mongoose.model('User').updateMany({}, { $set: { tenantId: null } });
  superToken = await loginStaff(app, 'PoBoss', 'pw');
  managerToken = await loginStaff(app, 'PoManager', 'pw');
  cashierToken = await loginStaff(app, 'PoCashier', 'pw');
}, 120000);

afterAll(async () => { await stop(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });

const draftBody = {
  supplier: 'Acme Supplies',
  expectedDate: '2026-08-01',
  notes: 'Weekly restock',
  lines: [
    { itemName: 'Coffee Beans', unit: 'kg', orderedQty: 10, unitCost: 250 },
    { itemName: 'Milk', unit: 'L', orderedQty: 20, unitCost: 80 },
  ],
};

// #Req-1: PO creation now goes through POST /api/requisitions + approval, not
// the direct route (superadmin-only break-glass now) - requests as `token`,
// approves as `superToken` (superadmin bypasses the accounting.manage gate),
// and returns the approval response so callers can read `.body.purchaseOrder`
// exactly like the old direct-create response.
const createPOviaRequisition = async (token, poPayload) => {
  const reqRes = await request(app).post('/api/requisitions').set(auth(token)).send({ type: 'purchase_order', poPayload });
  if (reqRes.status !== 201) return reqRes;
  return request(app).post(`/api/requisitions/${reqRes.body.requisition._id}/approve`).set(auth(superToken));
};

describe('purchase order creation', () => {
  it('rejects a PO with no valid lines', async () => {
    const res = await request(app).post('/api/purchase-orders').set(auth(superToken))
      .send({ supplier: 'X', lines: [{ itemName: '', orderedQty: 0 }] });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('creates a draft PO with an auto PO number, Ordered status, and est total', async () => {
    const res = await createPOviaRequisition(managerToken, draftBody);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const po = res.body.purchaseOrder;
    expect(po.poNumber).toMatch(/^PO-\d{4}-\d{6}$/);
    expect(po.status).toBe('Ordered');
    // 10*250 + 20*80 = 2500 + 1600 = 4100
    expect(po.estTotal).toBe(4100);
    expect(po.lines).toHaveLength(2);
    expect(po.lines[0].receivedQty).toBeNull();
    // createdBy is the ORIGINAL REQUESTER (manager), not the approver (super) -
    // #Req-1's whole point is a movement stays attributed to who asked for it.
    expect(po.createdBy).toBe('PoManager');
  });

  it('persists optional per-line unit, pack size, and expiry date', async () => {
    const res = await createPOviaRequisition(managerToken, {
      supplier: 'PackCo',
      lines: [{ itemName: 'Oatside 1L', unit: 'L', packSize: 1, orderedQty: 12, unitCost: 100, expiryDate: '2027-01-15' }],
    });
    expect(res.status).toBe(200);
    const line = res.body.purchaseOrder.lines[0];
    expect(line.unit).toBe('L');
    expect(line.packSize).toBe(1);
    expect(new Date(line.expiryDate).toISOString().slice(0, 10)).toBe('2027-01-15');
  });

  it('leaves pack size / expiry null when omitted (they are optional)', async () => {
    const res = await createPOviaRequisition(managerToken, {
      supplier: 'PlainCo',
      lines: [{ itemName: 'Sugar', unit: 'kg', orderedQty: 5, unitCost: 60 }],
    });
    expect(res.status).toBe(200);
    const line = res.body.purchaseOrder.lines[0];
    expect(line.packSize).toBeNull();
    expect(line.expiryDate).toBeNull();
  });

  it('requires auth', async () => {
    const res = await request(app).post('/api/purchase-orders').send(draftBody);
    expect(res.status).toBe(401);
  });

  it('a view-only role (cashier) cannot request a PO (needs procurement.manage)', async () => {
    const res = await request(app).post('/api/requisitions').set(auth(cashierToken)).send({ type: 'purchase_order', poPayload: draftBody });
    expect(res.status).toBe(403);
  });

  it('the direct create route is now superadmin-only break-glass, not manager-reachable', async () => {
    const res = await request(app).post('/api/purchase-orders').set(auth(managerToken)).send(draftBody);
    expect(res.status).toBe(403);
  });

  it('a view-only role can still list POs (procurement.view)', async () => {
    const res = await request(app).get('/api/purchase-orders').set(auth(cashierToken));
    expect(res.status).toBe(200);
  });
});

describe('status transitions', () => {
  let poId;
  beforeAll(async () => {
    const res = await request(app).post('/api/purchase-orders').set(auth(superToken)).send(draftBody);
    poId = res.body.purchaseOrder._id;
  });

  it('moves Ordered → Processing', async () => {
    const res = await request(app).patch(`/api/purchase-orders/${poId}`).set(auth(superToken)).send({ status: 'Processing' });
    expect(res.status).toBe(200);
    expect(res.body.purchaseOrder.status).toBe('Processing');
  });

  it('rejects setting a terminal status via PATCH (must use /receive)', async () => {
    const res = await request(app).patch(`/api/purchase-orders/${poId}`).set(auth(superToken)).send({ status: 'Complete' });
    expect(res.status).toBe(400);
  });
});

describe('receiving / reconciliation', () => {
  it('full delivery → Complete with actualTotal = est', async () => {
    const created = await request(app).post('/api/purchase-orders').set(auth(superToken)).send(draftBody);
    const po = created.body.purchaseOrder;
    const received = po.lines.map((l, i) => ({ lineId: l._id, index: i, receivedQty: l.orderedQty }));
    const res = await request(app).post(`/api/purchase-orders/${po._id}/receive`).set(auth(superToken)).send({ received });
    expect(res.status).toBe(200);
    expect(res.body.purchaseOrder.status).toBe('Complete');
    expect(res.body.purchaseOrder.actualTotal).toBe(4100);
    expect(res.body.purchaseOrder.receivedBy).toBe('PoBoss');
    expect(res.body.purchaseOrder.receivedAt).toBeTruthy();
  });

  it('short delivery → Incomplete with reduced actualTotal', async () => {
    const created = await request(app).post('/api/purchase-orders').set(auth(superToken)).send(draftBody);
    const po = created.body.purchaseOrder;
    // Receive only 5kg of beans (of 10) and all 20 milk → short
    const received = [
      { lineId: po.lines[0]._id, index: 0, receivedQty: 5 },
      { lineId: po.lines[1]._id, index: 1, receivedQty: 20 },
    ];
    const res = await request(app).post(`/api/purchase-orders/${po._id}/receive`).set(auth(superToken)).send({ received });
    expect(res.status).toBe(200);
    expect(res.body.purchaseOrder.status).toBe('Incomplete');
    // 5*250 + 20*80 = 1250 + 1600 = 2850
    expect(res.body.purchaseOrder.actualTotal).toBe(2850);
  });

  it('cannot receive an already-received PO', async () => {
    const created = await request(app).post('/api/purchase-orders').set(auth(superToken)).send(draftBody);
    const po = created.body.purchaseOrder;
    const received = po.lines.map((l, i) => ({ lineId: l._id, index: i, receivedQty: l.orderedQty }));
    await request(app).post(`/api/purchase-orders/${po._id}/receive`).set(auth(superToken)).send({ received });
    const again = await request(app).post(`/api/purchase-orders/${po._id}/receive`).set(auth(superToken)).send({ received });
    expect(again.status).toBe(409);
  });

  it('cannot edit a reconciled PO', async () => {
    const created = await request(app).post('/api/purchase-orders').set(auth(superToken)).send(draftBody);
    const po = created.body.purchaseOrder;
    const received = po.lines.map((l, i) => ({ lineId: l._id, index: i, receivedQty: l.orderedQty }));
    await request(app).post(`/api/purchase-orders/${po._id}/receive`).set(auth(superToken)).send({ received });
    const edit = await request(app).patch(`/api/purchase-orders/${po._id}`).set(auth(superToken)).send({ supplier: 'New' });
    expect(edit.status).toBe(409);
  });
});

describe('listing & deletion guards', () => {
  it('lists POs and filters by status', async () => {
    const all = await request(app).get('/api/purchase-orders').set(auth(cashierToken));
    expect(all.status).toBe(200);
    expect(Array.isArray(all.body.purchaseOrders)).toBe(true);
    const completed = await request(app).get('/api/purchase-orders?status=Complete').set(auth(cashierToken));
    expect(completed.body.purchaseOrders.every(p => p.status === 'Complete')).toBe(true);
  });

  it('superadmin can delete a draft; a received PO cannot be deleted', async () => {
    const draft = await request(app).post('/api/purchase-orders').set(auth(superToken)).send(draftBody);
    const draftId = draft.body.purchaseOrder._id;
    const del = await request(app).delete(`/api/purchase-orders/${draftId}`).set(auth(superToken));
    expect(del.status).toBe(200);

    const created = await request(app).post('/api/purchase-orders').set(auth(superToken)).send(draftBody);
    const po = created.body.purchaseOrder;
    const received = po.lines.map((l, i) => ({ lineId: l._id, index: i, receivedQty: l.orderedQty }));
    await request(app).post(`/api/purchase-orders/${po._id}/receive`).set(auth(superToken)).send({ received });
    const del2 = await request(app).delete(`/api/purchase-orders/${po._id}`).set(auth(superToken));
    expect(del2.status).toBe(409);
  });

  it('a manager (manage but not delete) cannot delete a PO', async () => {
    const draft = await createPOviaRequisition(managerToken, draftBody);
    expect(draft.status).toBe(200); // manager CAN request+get one approved
    const del = await request(app).delete(`/api/purchase-orders/${draft.body.purchaseOrder._id}`).set(auth(managerToken));
    expect(del.status).toBe(403);   // ...but NOT delete (needs procurement.delete)
  });
});

describe('supplier CRUD + permission gating', () => {
  let supplierId;
  it('manager can create a supplier', async () => {
    const res = await request(app).post('/api/suppliers').set(auth(managerToken))
      .send({ name: 'Best Beans Co', contactPerson: 'Jo', phone: '0917', email: 'jo@beans.test', address: 'Cebu' });
    expect(res.status).toBe(201);
    expect(res.body.supplier.supplierCode).toMatch(/^SUP-\d{4}-\d{6}$/);
    supplierId = res.body.supplier._id;
  });

  it('requires a name', async () => {
    const res = await request(app).post('/api/suppliers').set(auth(managerToken)).send({ name: '  ' });
    expect(res.status).toBe(400);
  });

  it('view-only cashier cannot create a supplier but can list', async () => {
    const create = await request(app).post('/api/suppliers').set(auth(cashierToken)).send({ name: 'Nope' });
    expect(create.status).toBe(403);
    const list = await request(app).get('/api/suppliers').set(auth(cashierToken));
    expect(list.status).toBe(200);
  });

  it('manager can edit; only delete-capable roles can delete', async () => {
    // Self-contained: create its own supplier so it never races other tests.
    const created = await request(app).post('/api/suppliers').set(auth(managerToken)).send({ name: 'Editable Supplier' });
    const id = created.body.supplier._id;
    const edit = await request(app).patch(`/api/suppliers/${id}`).set(auth(managerToken)).send({ phone: '0999' });
    expect(edit.status).toBe(200);
    expect(edit.body.supplier.phone).toBe('0999');
    const del = await request(app).delete(`/api/suppliers/${id}`).set(auth(managerToken));
    expect(del.status).toBe(403);
    const delOk = await request(app).delete(`/api/suppliers/${id}`).set(auth(superToken));
    expect(delOk.status).toBe(200);
  });
});

describe('receiving posts to inventory + is repeatable until fully received', () => {
  let invId;
  beforeAll(async () => {
    const Inventory = mongoose.model('Inventory');
    const inv = await Inventory.create({
      itemCode: 'PO-RCV-MILK', itemName: 'Receiving Milk', stockQty: 0, unit: 'ml',
      unitCost: 0, displayUnit: 'L', unitMultiplier: 1000, packSize: 1,
    });
    invId = String(inv._id);
  });

  it('a linked line posts its received qty to Inventory + a journal entry', async () => {
    const Inventory = mongoose.model('Inventory');
    const JournalEntry = mongoose.model('JournalEntry');
    const created = await request(app).post('/api/purchase-orders').set(auth(superToken)).send({
      supplier: 'Milk Co', lines: [{ invId, itemName: 'Receiving Milk', unit: 'L', packSize: 1, orderedQty: 10, unitCost: 80 }],
    });
    const po = created.body.purchaseOrder;
    const res = await request(app).post(`/api/purchase-orders/${po._id}/receive`).set(auth(superToken))
      .send({ received: [{ lineId: po.lines[0]._id, receivedQty: 10 }] });
    expect(res.status).toBe(200);
    expect(res.body.purchaseOrder.status).toBe('Complete');

    const inv = await Inventory.findById(invId).lean();
    expect(inv.stockQty).toBe(10000); // 10 packs × 1L × 1000 ml/L
    expect(inv.unitCost).toBeCloseTo(80 / 1000, 6); // ₱80/pack ÷ 1000ml = ₱/ml

    const je = await JournalEntry.findOne({ reference: /^PO-RCV/ }).sort({ createdAt: -1 }).lean();
    expect(je).toBeTruthy();
    const codes = je.lines.map(l => l.accountCode);
    expect(codes).toContain('130000'); // Inventory Asset debited
    expect(codes).toContain('220000'); // Accounts Payable credited (default)
    expect(je.totalDebit).toBeCloseTo(800, 2); // 10 × ₱80
  });

  it('a short delivery stays Incomplete and receivable - a follow-up receive tops it up to Complete', async () => {
    const Inventory = mongoose.model('Inventory');
    const created = await request(app).post('/api/purchase-orders').set(auth(superToken)).send({
      supplier: 'Milk Co', lines: [{ invId, itemName: 'Receiving Milk', unit: 'L', packSize: 1, orderedQty: 10, unitCost: 80 }],
    });
    const po = created.body.purchaseOrder;
    const lineId = po.lines[0]._id;
    const before = (await Inventory.findById(invId).lean()).stockQty;

    // First delivery: only 6 of 10 arrive.
    const r1 = await request(app).post(`/api/purchase-orders/${po._id}/receive`).set(auth(superToken))
      .send({ received: [{ lineId, receivedQty: 6 }] });
    expect(r1.status).toBe(200);
    expect(r1.body.purchaseOrder.status).toBe('Incomplete');
    expect(r1.body.purchaseOrder.lines[0].receivedQty).toBe(6);
    const afterFirst = (await Inventory.findById(invId).lean()).stockQty;
    expect(afterFirst - before).toBe(6000); // 6 packs × 1000ml - only the delta posted

    // Still receivable (not terminal) - a second delivery brings the rest (4 more).
    const r2 = await request(app).post(`/api/purchase-orders/${po._id}/receive`).set(auth(superToken))
      .send({ received: [{ lineId, receivedQty: 4 }] });
    expect(r2.status).toBe(200);
    expect(r2.body.purchaseOrder.status).toBe('Complete');
    expect(r2.body.purchaseOrder.lines[0].receivedQty).toBe(10); // cumulative, not overwritten
    const afterSecond = (await Inventory.findById(invId).lean()).stockQty;
    expect(afterSecond - afterFirst).toBe(4000); // only the SECOND delta posted, not the full 10 again

    // Now Complete IS terminal.
    const r3 = await request(app).post(`/api/purchase-orders/${po._id}/receive`).set(auth(superToken))
      .send({ received: [{ lineId, receivedQty: 1 }] });
    expect(r3.status).toBe(409);
  });

  it('an unlinked line (no invId) tracks receivedQty but never touches Inventory or posts a journal entry', async () => {
    const JournalEntry = mongoose.model('JournalEntry');
    const created = await request(app).post('/api/purchase-orders').set(auth(superToken)).send({
      supplier: 'Misc Supplier', lines: [{ itemName: 'Hand-typed Widget', unit: 'pcs', orderedQty: 5, unitCost: 20 }],
    });
    const po = created.body.purchaseOrder;
    const res = await request(app).post(`/api/purchase-orders/${po._id}/receive`).set(auth(superToken))
      .send({ received: [{ lineId: po.lines[0]._id, receivedQty: 5 }] });
    expect(res.status).toBe(200);
    expect(res.body.purchaseOrder.status).toBe('Complete');
    // No journal entry should exist for this receive - nothing real to debit.
    const je = await JournalEntry.findOne({ description: new RegExp(po.poNumber) }).lean();
    expect(je).toBeFalsy();
  });

  it('lines omitted from a follow-up receive are left untouched', async () => {
    const created = await request(app).post('/api/purchase-orders').set(auth(superToken)).send({
      supplier: 'Two Line Co',
      lines: [
        { invId, itemName: 'Receiving Milk', unit: 'L', packSize: 1, orderedQty: 5, unitCost: 80 },
        { itemName: 'Other Thing', unit: 'pcs', orderedQty: 3, unitCost: 10 },
      ],
    });
    const po = created.body.purchaseOrder;
    // Only receive the milk line; omit the other line entirely from the payload.
    const r1 = await request(app).post(`/api/purchase-orders/${po._id}/receive`).set(auth(superToken))
      .send({ received: [{ lineId: po.lines[0]._id, receivedQty: 5 }] });
    expect(r1.status).toBe(200);
    expect(r1.body.purchaseOrder.status).toBe('Incomplete');
    expect(r1.body.purchaseOrder.lines[0].receivedQty).toBe(5);
    expect(r1.body.purchaseOrder.lines[1].receivedQty).toBeNull(); // untouched (never submitted a delta), not reset to 0
  });
});

describe('cancelling the remainder of a partially-received PO', () => {
  let invId;
  beforeAll(async () => {
    const Inventory = mongoose.model('Inventory');
    const inv = await Inventory.create({
      itemCode: 'PO-CANCEL-MILK', itemName: 'Cancel Remainder Milk', stockQty: 0, unit: 'ml',
      unitCost: 0, displayUnit: 'L', unitMultiplier: 1000, packSize: 1,
    });
    invId = String(inv._id);
  });

  it('PATCH status=Cancelled on an Incomplete PO closes it out without touching already-received stock', async () => {
    const Inventory = mongoose.model('Inventory');
    const created = await request(app).post('/api/purchase-orders').set(auth(superToken)).send({
      supplier: 'Cancel Co', lines: [{ invId, itemName: 'Cancel Remainder Milk', unit: 'L', packSize: 1, orderedQty: 10, unitCost: 80 }],
    });
    const po = created.body.purchaseOrder;
    await request(app).post(`/api/purchase-orders/${po._id}/receive`).set(auth(superToken))
      .send({ received: [{ lineId: po.lines[0]._id, receivedQty: 4 }] }); // short delivery -> Incomplete
    const stockAfterReceive = (await Inventory.findById(invId).lean()).stockQty;

    const cancel = await request(app).patch(`/api/purchase-orders/${po._id}`).set(auth(superToken)).send({ status: 'Cancelled' });
    expect(cancel.status).toBe(200);
    expect(cancel.body.purchaseOrder.status).toBe('Cancelled');
    expect(cancel.body.purchaseOrder.lines[0].receivedQty).toBe(4); // the 4 already received is untouched

    const stockAfterCancel = (await Inventory.findById(invId).lean()).stockQty;
    expect(stockAfterCancel).toBe(stockAfterReceive); // no reversal - nothing was un-received

    // A cancelled-with-received-activity PO can no longer be received or deleted.
    const receiveAgain = await request(app).post(`/api/purchase-orders/${po._id}/receive`).set(auth(superToken))
      .send({ received: [{ lineId: po.lines[0]._id, receivedQty: 1 }] });
    expect(receiveAgain.status).toBe(409);
    const del = await request(app).delete(`/api/purchase-orders/${po._id}`).set(auth(superToken));
    expect(del.status).toBe(409);
  });

  it('an Incomplete PO rejects edits to fields other than cancelling', async () => {
    const created = await request(app).post('/api/purchase-orders').set(auth(superToken)).send({
      supplier: 'Reject Edit Co', lines: [{ invId, itemName: 'Cancel Remainder Milk', unit: 'L', packSize: 1, orderedQty: 10, unitCost: 80 }],
    });
    const po = created.body.purchaseOrder;
    await request(app).post(`/api/purchase-orders/${po._id}/receive`).set(auth(superToken))
      .send({ received: [{ lineId: po.lines[0]._id, receivedQty: 3 }] }); // -> Incomplete

    const editSupplier = await request(app).patch(`/api/purchase-orders/${po._id}`).set(auth(superToken)).send({ supplier: 'New Name' });
    expect(editSupplier.status).toBe(409);
    const editStatus = await request(app).patch(`/api/purchase-orders/${po._id}`).set(auth(superToken)).send({ status: 'Processing' });
    expect(editStatus.status).toBe(409);
  });
});
