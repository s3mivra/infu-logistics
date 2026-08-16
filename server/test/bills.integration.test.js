// AP bill approval workflow - manual bills, PO-triggered bills, approve/reject,
// payment scheduling, and paying a bill. Drives the real Express app over HTTP
// against an in-memory replica set, same harness as critical-paths.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok, supplierId, inv, prod;
const auth = (method, path, token) => request(app)[method](path).set('Authorization', `Bearer ${token}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'billsSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'billsSuper');

  const Supplier = mongoose.model('Supplier');
  const Inventory = mongoose.model('Inventory');
  const Product = mongoose.model('Product');
  const Category = mongoose.model('Category');
  await Category.create({ name: 'BillsCat', department: 'Kitchen' });
  const supplier = await Supplier.create({ name: 'Acme Supplies', supplierCode: 'SUP-TEST-1' });
  supplierId = String(supplier._id);
  inv = await Inventory.create({ itemName: 'Widget', itemCode: 'WID-1', stockQty: 100, unit: 'pcs', unitCost: 5 });
  prod = await Product.create({ name: 'Widget', category: 'BillsCat', basePrice: 20, baseRecipe: [] });
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('manual bill: create -> approve posts JE -> pay', () => {
  let billId;

  it('rejects creating a bill without a valid expense account', async () => {
    const res = await auth('post', '/api/bills', tok).send({
      supplierId, description: 'June electricity', amount: 500,
    });
    expect(res.status).toBe(400);
  });

  it('creates a Pending manual bill with no journal entry yet', async () => {
    const JournalEntry = mongoose.model('JournalEntry');
    const before = await JournalEntry.countDocuments({});
    const res = await auth('post', '/api/bills', tok).send({
      supplierId, description: 'June electricity', amount: 500, expenseAccountCode: '520000',
    });
    expect(res.status).toBe(200);
    expect(res.body.bill.status).toBe('Pending');
    expect(res.body.bill.source).toBe('Manual');
    billId = res.body.bill._id;
    const after = await JournalEntry.countDocuments({});
    expect(after).toBe(before); // approval hasn't happened yet - no posting
  });

  it('cannot be scheduled or paid while Pending', async () => {
    const schedRes = await auth('patch', `/api/bills/${billId}/schedule`, tok).send({ scheduledPaymentDate: '2026-09-01' });
    expect(schedRes.status).toBe(409);
    const payRes = await auth('post', `/api/bills/${billId}/pay`, tok).send({ payFromAccount: '111000' });
    expect(payRes.status).toBe(409);
  });

  it('approving posts a balanced DR expense / CR A/P journal entry', async () => {
    const res = await auth('post', `/api/bills/${billId}/approve`, tok);
    expect(res.status).toBe(200);
    expect(res.body.bill.status).toBe('Approved');
    expect(res.body.bill.approvedBy).toBe('billsSuper');

    const JournalEntry = mongoose.model('JournalEntry');
    const je = await JournalEntry.findOne({ reference: res.body.bill.journalEntryRef }).lean();
    expect(je).toBeTruthy();
    expect(je.totalDebit).toBeCloseTo(je.totalCredit, 6);
    const codes = je.lines.map((l) => l.accountCode);
    expect(codes).toEqual(expect.arrayContaining(['520000', '220000']));
  });

  it('can now be scheduled', async () => {
    const res = await auth('patch', `/api/bills/${billId}/schedule`, tok).send({ scheduledPaymentDate: '2026-09-01' });
    expect(res.status).toBe(200);
    expect(res.body.bill.scheduledPaymentDate).toBeTruthy();

    const upcoming = await auth('get', '/api/bills/upcoming', tok);
    expect(upcoming.status).toBe(200);
    expect(upcoming.body.bills.some((b) => b._id === billId)).toBe(true);
  });

  it('paying posts the A/P settlement and marks the bill Paid', async () => {
    const res = await auth('post', `/api/bills/${billId}/pay`, tok).send({ payFromAccount: '111000' });
    expect(res.status).toBe(200);
    expect(res.body.bill.status).toBe('Paid');
    expect(res.body.bill.paidAt).toBeTruthy();

    // A second payment attempt must be rejected - already Paid, not Approved.
    const again = await auth('post', `/api/bills/${billId}/pay`, tok).send({ payFromAccount: '111000' });
    expect(again.status).toBe(409);
  });
});

describe('manual bill rejection', () => {
  it('rejecting requires a reason and never posts a journal entry', async () => {
    const JournalEntry = mongoose.model('JournalEntry');
    const create = await auth('post', '/api/bills', tok).send({
      supplierId, description: 'Disputed charge', amount: 100, expenseAccountCode: '520000',
    });
    const id = create.body.bill._id;

    const noReason = await auth('post', `/api/bills/${id}/reject`, tok).send({});
    expect(noReason.status).toBe(400);

    const before = await JournalEntry.countDocuments({});
    const res = await auth('post', `/api/bills/${id}/reject`, tok).send({ reason: 'Not our charge' });
    expect(res.status).toBe(200);
    expect(res.body.bill.status).toBe('Rejected');
    const after = await JournalEntry.countDocuments({});
    expect(after).toBe(before);

    // A rejected bill is terminal - approving it afterward must fail.
    const approveAfter = await auth('post', `/api/bills/${id}/approve`, tok);
    expect(approveAfter.status).toBe(409);
  });
});

describe('PO receipt auto-creates a Bill', () => {
  it('receiving a PO with a linked supplier creates a Pending PO-sourced bill, JE already posted', async () => {
    const poRes = await auth('post', '/api/purchase-orders', tok).send({
      supplier: 'Acme Supplies',
      supplierId,
      lines: [{ invId: String(inv._id), itemName: 'Widget', itemCode: 'WID-1', unit: 'pcs', orderedQty: 10, unitCost: 5 }],
    });
    expect(poRes.status).toBe(201);
    const poId = poRes.body.purchaseOrder._id;

    const JournalEntry = mongoose.model('JournalEntry');
    const beforeJe = await JournalEntry.countDocuments({});

    const recvRes = await auth('post', `/api/purchase-orders/${poId}/receive`, tok).send({
      received: [{ index: 0, receivedQty: 10 }],
    });
    expect(recvRes.status).toBe(200);
    expect(recvRes.body.bill).toBeTruthy();
    expect(recvRes.body.bill.source).toBe('PO');
    expect(recvRes.body.bill.status).toBe('Pending');
    expect(recvRes.body.bill.amount).toBeCloseTo(50, 2); // 10 * 5

    // The A/P journal entry posts immediately at receipt - NOT gated by bill approval.
    const afterJe = await JournalEntry.countDocuments({});
    expect(afterJe).toBe(beforeJe + 1);

    // Approving a PO-sourced bill must NOT post a second journal entry.
    const approve = await auth('post', `/api/bills/${recvRes.body.bill._id}/approve`, tok);
    expect(approve.status).toBe(200);
    const afterApprove = await JournalEntry.countDocuments({});
    expect(afterApprove).toBe(beforeJe + 1);
  });
});
