// Partial refund: refund SPECIFIC line items and SPECIFIC quantities within
// them - not the whole order, and not necessarily all in one pass. Mirrors the
// unvoid/void integration tests' fixture pattern (a 1:1 logistics product
// linked to its own Inventory item via matching name/code).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let app, stop, superToken, cashierToken, invAId, invBId, productAId, productBId;

const auth = (t) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'log', jwtSecret: 'partial-refund-secret-0123456789' }));
  await makeUser({ name: 'PrBoss', role: 'superadmin', password: 'pw' });
  await makeUser({ name: 'PrCashier', role: 'cashier', password: 'pw' });
  await mongoose.model('User').updateMany({}, { $set: { tenantId: null } });
  superToken = await loginStaff(app, 'PrBoss', 'pw');
  cashierToken = await loginStaff(app, 'PrCashier', 'pw');

  const invA = await mongoose.model('Inventory').create({
    itemCode: 'PR-WIDGET-A', itemName: 'Widget Alpha', stockQty: 1000, unit: 'pcs',
    unitCost: 40, displayUnit: 'pcs', unitMultiplier: 1, packSize: 1, businessType: 'log',
  });
  invAId = String(invA._id);
  const prodA = await request(app).post('/api/products').set(auth(superToken))
    .send({ name: 'Widget Alpha', category: 'Dry Goods', basePrice: 100 });
  productAId = prodA.body.product._id;

  const invB = await mongoose.model('Inventory').create({
    itemCode: 'PR-WIDGET-B', itemName: 'Widget Beta', stockQty: 1000, unit: 'pcs',
    unitCost: 20, displayUnit: 'pcs', unitMultiplier: 1, packSize: 1, businessType: 'log',
  });
  invBId = String(invB._id);
  const prodB = await request(app).post('/api/products').set(auth(superToken))
    .send({ name: 'Widget Beta', category: 'Dry Goods', basePrice: 50 });
  productBId = prodB.body.product._id;
}, 120000);

afterAll(async () => { await stop(); });

const stockOf = async (id) => (await mongoose.model('Inventory').findById(id).lean()).stockQty;

// One line (A, qty 5 @ ₱100) or two lines (A qty 5 @ ₱100, B qty 4 @ ₱50).
const makeSale = async ({ twoLines = false } = {}) => {
  const items = [{ productId: productAId, name: 'Widget Alpha', price: 100, quantity: 5 }];
  if (twoLines) items.push({ productId: productBId, name: 'Widget Beta', price: 50, quantity: 4 });
  const created = await request(app).post('/api/orders').set(auth(superToken)).send({
    customerName: 'Partial Refund Tester', paymentMethod: 'Cash', items,
  });
  const id = created.body.order._id;
  await request(app).put(`/api/orders/${id}`).set(auth(superToken)).send({ status: 'Completed' });
  const res = await request(app).get(`/api/orders/${id}`).set(auth(superToken));
  return res.body.order || res.body; // whichever shape GET /api/orders/:id returns
};

describe('partial refund - qty within a single line', () => {
  it('refunding 2 of 5 restocks proportionally and keeps the order Completed', async () => {
    const before = await stockOf(invAId);
    const order = await makeSale();
    const afterSale = await stockOf(invAId);
    expect(afterSale).toBeLessThan(before); // the sale deducted 5

    const res = await request(app).post(`/api/orders/${order._id}/partial-refund`).set(auth(superToken))
      .send({ items: [{ itemIndex: 0, qty: 2 }], reason: 'Customer kept 3 of 5', inventoryAction: 'Restock' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.fullyRefunded).toBe(false);
    // 2/5 of ₱500 (5 × ₱100) = ₱200
    expect(res.body.refundAmount).toBeCloseTo(200, 2);

    const afterRefund = await stockOf(invAId);
    expect(afterRefund).toBeCloseTo(afterSale + 2, 6); // exactly 2 units back, not all 5

    const check = await request(app).get(`/api/orders/${order._id}`).set(auth(superToken));
    const updated = check.body.order || check.body;
    expect(updated.status).toBe('Completed'); // NOT terminal - only part of the order was refunded
    expect(updated.items[0].refundedQty).toBe(2);
  });

  it('the returned stock lands in its own batch (FEFO-consistent), not just a flat stockQty bump', async () => {
    // A fresh, never-sold item so the sale itself doesn't touch expiryBatches
    // (existing behavior: a sale only FEFO-consumes batches an item already
    // has - see orders.js "audit info; stockQty is source of truth"). Starting
    // from zero isolates what the REFUND's restock does to expiryBatches.
    const invFresh = await mongoose.model('Inventory').create({
      itemCode: 'PR-FRESH', itemName: 'Fresh Batch Widget', stockQty: 3, unit: 'pcs',
      unitCost: 40, displayUnit: 'pcs', unitMultiplier: 1, packSize: 1, businessType: 'log',
    });
    const prodFresh = await request(app).post('/api/products').set(auth(superToken))
      .send({ name: 'Fresh Batch Widget', category: 'Dry Goods', basePrice: 100 });

    const created = await request(app).post('/api/orders').set(auth(superToken)).send({
      customerName: 'Fresh Batch Tester', paymentMethod: 'Cash',
      items: [{ productId: prodFresh.body.product._id, name: 'Fresh Batch Widget', price: 100, quantity: 2 }],
    });
    const orderId = created.body.order._id;
    await request(app).put(`/api/orders/${orderId}`).set(auth(superToken)).send({ status: 'Completed' });

    const res = await request(app).post(`/api/orders/${orderId}/partial-refund`).set(auth(superToken))
      .send({ items: [{ itemIndex: 0, qty: 1 }], reason: 'One defective unit', inventoryAction: 'Restock' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const invAfter = await mongoose.model('Inventory').findById(invFresh._id).lean();
    const batchTotalAfter = (invAfter.expiryBatches || []).reduce((s, b) => s + (b.qty || 0), 0);
    expect(invAfter.stockQty).toBe(2); // 3 - 2 (sale) + 1 (refund)
    expect(batchTotalAfter).toBeCloseTo(1, 6); // the refund created exactly one batch of 1
  });

  it('rejects refunding more than what remains on the line', async () => {
    const order = await makeSale();
    const res = await request(app).post(`/api/orders/${order._id}/partial-refund`).set(auth(superToken))
      .send({ items: [{ itemIndex: 0, qty: 6 }], reason: 'Too many', inventoryAction: 'None' });
    expect(res.status).toBe(400);
  });

  it('multiple passes accumulate refundedQty and cap at the ordered quantity', async () => {
    const order = await makeSale();
    const r1 = await request(app).post(`/api/orders/${order._id}/partial-refund`).set(auth(superToken))
      .send({ items: [{ itemIndex: 0, qty: 2 }], reason: 'First return', inventoryAction: 'None' });
    expect(r1.status).toBe(200);
    // Only 3 left (5 - 2) - asking for 4 more must fail even though 2+4=6 > 5.
    const rTooMany = await request(app).post(`/api/orders/${order._id}/partial-refund`).set(auth(superToken))
      .send({ items: [{ itemIndex: 0, qty: 4 }], reason: 'Second return', inventoryAction: 'None' });
    expect(rTooMany.status).toBe(400);
    // Exactly the remaining 3 succeeds and fully refunds the (single-line) order.
    const r2 = await request(app).post(`/api/orders/${order._id}/partial-refund`).set(auth(superToken))
      .send({ items: [{ itemIndex: 0, qty: 3 }], reason: 'Second return', inventoryAction: 'None' });
    expect(r2.status, JSON.stringify(r2.body)).toBe(200);
    expect(r2.body.fullyRefunded).toBe(true);

    const check = await request(app).get(`/api/orders/${order._id}`).set(auth(superToken));
    const updated = check.body.order || check.body;
    expect(updated.status).toBe('Refunded');
    expect(updated.items[0].refundedQty).toBe(5);
  });

  it('refuses any further partial refund once the order is fully refunded', async () => {
    const order = await makeSale();
    await request(app).post(`/api/orders/${order._id}/partial-refund`).set(auth(superToken))
      .send({ items: [{ itemIndex: 0, qty: 5 }], reason: 'All returned', inventoryAction: 'None' });
    const res = await request(app).post(`/api/orders/${order._id}/partial-refund`).set(auth(superToken))
      .send({ items: [{ itemIndex: 0, qty: 1 }], reason: 'Too late', inventoryAction: 'None' });
    expect(res.status).toBe(400);
  });
});

describe('partial refund - multi-line orders only close out what was selected', () => {
  it('refunding one of two lines leaves the order Completed with the other line untouched', async () => {
    const order = await makeSale({ twoLines: true });
    const res = await request(app).post(`/api/orders/${order._id}/partial-refund`).set(auth(superToken))
      .send({ items: [{ itemIndex: 0, qty: 5 }], reason: 'Line A entirely returned', inventoryAction: 'None' });
    expect(res.status).toBe(200);
    expect(res.body.fullyRefunded).toBe(false); // line B (qty 4) was never touched

    const check = await request(app).get(`/api/orders/${order._id}`).set(auth(superToken));
    const updated = check.body.order || check.body;
    expect(updated.status).toBe('Completed');
    expect(updated.items[0].refundedQty).toBe(5);
    expect(updated.items[1].refundedQty).toBe(0);
  });

  it('refunding both lines fully (even across two calls) fully refunds the order', async () => {
    const order = await makeSale({ twoLines: true });
    await request(app).post(`/api/orders/${order._id}/partial-refund`).set(auth(superToken))
      .send({ items: [{ itemIndex: 0, qty: 5 }], reason: 'Line A', inventoryAction: 'None' });
    const res = await request(app).post(`/api/orders/${order._id}/partial-refund`).set(auth(superToken))
      .send({ items: [{ itemIndex: 1, qty: 4 }], reason: 'Line B', inventoryAction: 'None' });
    expect(res.status).toBe(200);
    expect(res.body.fullyRefunded).toBe(true);
  });

  it('rejects duplicate item indices in one request', async () => {
    const order = await makeSale({ twoLines: true });
    const res = await request(app).post(`/api/orders/${order._id}/partial-refund`).set(auth(superToken))
      .send({ items: [{ itemIndex: 0, qty: 1 }, { itemIndex: 0, qty: 1 }], reason: 'Dup', inventoryAction: 'None' });
    expect(res.status).toBe(400);
  });

  it('rejects an out-of-range item index', async () => {
    const order = await makeSale();
    const res = await request(app).post(`/api/orders/${order._id}/partial-refund`).set(auth(superToken))
      .send({ items: [{ itemIndex: 5, qty: 1 }], reason: 'Bad index', inventoryAction: 'None' });
    expect(res.status).toBe(400);
  });
});

describe('partial refund - Spoilage vs None inventory actions', () => {
  it('Spoilage reclasses COGS to waste expense but does NOT restock', async () => {
    const order = await makeSale();
    const before = await stockOf(invAId);
    const res = await request(app).post(`/api/orders/${order._id}/partial-refund`).set(auth(superToken))
      .send({ items: [{ itemIndex: 0, qty: 2 }], reason: 'Damaged in return', inventoryAction: 'Spoilage' });
    expect(res.status).toBe(200);
    const after = await stockOf(invAId);
    expect(after).toBeCloseTo(before, 6); // unchanged - goods were spoiled, not put back

    const JournalEntry = mongoose.model('JournalEntry');
    const je = await JournalEntry.findOne({ reference: /^PARTIAL-REFUND/, description: new RegExp(order.orderNumber) }).sort({ createdAt: -1 }).lean();
    expect(je).toBeTruthy();
    const codes = je.lines.map(l => l.accountCode);
    expect(codes).toContain('535000'); // Spoilage, Variance & Waste Expense
    expect(codes).not.toContain('130000'); // Inventory Asset NOT debited
  });

  it('None leaves inventory and COGS completely alone, only cash/revenue reverses', async () => {
    const order = await makeSale();
    const before = await stockOf(invAId);
    const res = await request(app).post(`/api/orders/${order._id}/partial-refund`).set(auth(superToken))
      .send({ items: [{ itemIndex: 0, qty: 2 }], reason: 'Goodwill cash refund only', inventoryAction: 'None' });
    expect(res.status).toBe(200);
    const after = await stockOf(invAId);
    expect(after).toBeCloseTo(before, 6);

    const JournalEntry = mongoose.model('JournalEntry');
    const je = await JournalEntry.findOne({ reference: /^PARTIAL-REFUND/, description: new RegExp(order.orderNumber) }).sort({ createdAt: -1 }).lean();
    const codes = je.lines.map(l => l.accountCode);
    expect(codes).toContain('410000'); // Sales Revenue reversed
    expect(codes).not.toContain('130000');
    expect(codes).not.toContain('535000');
  });

  it('the journal entry always balances', async () => {
    const order = await makeSale();
    const res = await request(app).post(`/api/orders/${order._id}/partial-refund`).set(auth(superToken))
      .send({ items: [{ itemIndex: 0, qty: 2 }], reason: 'Balance check', inventoryAction: 'Restock' });
    expect(res.status).toBe(200);
    const JournalEntry = mongoose.model('JournalEntry');
    const je = await JournalEntry.findOne({ reference: /^PARTIAL-REFUND/, description: new RegExp(order.orderNumber) }).sort({ createdAt: -1 }).lean();
    expect(je.totalDebit).toBeCloseTo(je.totalCredit, 2);
  });
});

describe('partial refund - guards', () => {
  it('requires admin/superadmin, not a plain cashier', async () => {
    const order = await makeSale();
    const res = await request(app).post(`/api/orders/${order._id}/partial-refund`).set(auth(cashierToken))
      .send({ items: [{ itemIndex: 0, qty: 1 }], reason: 'Nope', inventoryAction: 'None' });
    expect(res.status).toBe(403);
  });

  it('requires a reason', async () => {
    const order = await makeSale();
    const res = await request(app).post(`/api/orders/${order._id}/partial-refund`).set(auth(superToken))
      .send({ items: [{ itemIndex: 0, qty: 1 }], inventoryAction: 'None' });
    expect(res.status).toBe(400);
  });

  it('requires at least one item', async () => {
    const order = await makeSale();
    const res = await request(app).post(`/api/orders/${order._id}/partial-refund`).set(auth(superToken))
      .send({ items: [], reason: 'Empty', inventoryAction: 'None' });
    expect(res.status).toBe(400);
  });

  it('404s on a missing order', async () => {
    const res = await request(app).post(`/api/orders/${new mongoose.Types.ObjectId()}/partial-refund`).set(auth(superToken))
      .send({ items: [{ itemIndex: 0, qty: 1 }], reason: 'Missing', inventoryAction: 'None' });
    expect(res.status).toBe(404);
  });

  it('refuses to partial-refund a non-Completed order', async () => {
    const order = await makeSale();
    await mongoose.model('Order').updateOne({ _id: order._id }, { $set: { status: 'Voided' } });
    const res = await request(app).post(`/api/orders/${order._id}/partial-refund`).set(auth(superToken))
      .send({ items: [{ itemIndex: 0, qty: 1 }], reason: 'Already voided', inventoryAction: 'None' });
    expect(res.status).toBe(400);
  });
});
