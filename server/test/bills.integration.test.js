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

describe('paying a bill with an external reference number', () => {
  it('stores it on the bill and the journal entry description, for reconciliation', async () => {
    const created = await auth('post', '/api/bills', tok).send({
      supplierId, description: 'July electricity', amount: 300, expenseAccountCode: '520000',
    });
    const id = created.body.bill._id;
    await auth('post', `/api/bills/${id}/approve`, tok);

    const res = await auth('post', `/api/bills/${id}/pay`, tok).send({ payFromAccount: '111000', referenceNumber: 'CHECK-00219' });
    expect(res.status).toBe(200);
    expect(res.body.bill.paymentReference).toBe('CHECK-00219');

    const je = await mongoose.model('JournalEntry').findOne({ reference: res.body.bill.journalEntryRef }).lean();
    expect(je.description).toContain('CHECK-00219');
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

    // A PO bill is released only once the supplier's invoice matches.
    const early = await auth('post', `/api/bills/${recvRes.body.bill._id}/approve`, tok);
    expect(early.status).toBe(409);
    expect(early.body.needsInvoice).toBe(true);
    const invRes = await auth('post', `/api/bills/${recvRes.body.bill._id}/invoice`, tok).send({ supplierInvoiceNo: 'ACME-001', invoiceAmount: 50 });
    expect(invRes.body.match.status).toBe('Matched');

    // Approving a PO-sourced bill must NOT post a second journal entry.
    const approve = await auth('post', `/api/bills/${recvRes.body.bill._id}/approve`, tok);
    expect(approve.status).toBe(200);
    const afterApprove = await JournalEntry.countDocuments({});
    expect(afterApprove).toBe(beforeJe + 1);
  });
});

describe('a PO number on a payable that did not come from a PO here', () => {
  // A bill as the workbook's Bills sheet brings it in: pending, marked carried in.
  const carriedIn = async (body) => {
    const made = await auth('post', '/api/bills', tok).send({ supplierId, ...body });
    await mongoose.model('Bill').updateOne({ _id: made.body.bill._id }, { $set: { imported: true } });
    return made;
  };

  it('arrives with the workbook row, can be written on afterwards, and shows on the matching PO', async () => {
    const Bill = mongoose.model('Bill');
    const imp = await auth('post', '/api/setup/open-payables/import', tok).send({ rows: [
      { supplier: 'Acme Supplies', invoiceNo: 'INV-PO-1', amountOwed: 900, poNumber: 'PO-OLD-77' },
      { supplier: 'Acme Supplies', invoiceNo: 'INV-PO-2', amountOwed: 400 },
    ] });
    expect(imp.status, JSON.stringify(imp.body)).toBe(200);
    expect(imp.body.created).toBe(2);
    expect((await Bill.findOne({ supplierInvoiceNo: 'INV-PO-1' }).lean()).poNumber).toBe('PO-OLD-77');

    const po = await mongoose.model('PurchaseOrder').create({ poNumber: 'PO-TEST-LINK', supplier: 'Acme Supplies', status: 'Ordered', lines: [], estTotal: 400 });
    const second = await Bill.findOne({ supplierInvoiceNo: 'INV-PO-2' }).lean();
    const set = await auth('patch', `/api/bills/${second._id}/po-number`, tok).send({ poNumber: 'PO-TEST-LINK' });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body.bill.poNumber).toBe('PO-TEST-LINK');
    expect(set.body.linked).toBe(true);
    expect(String(set.body.bill.purchaseOrderId)).toBe(String(po._id));
    // Linked, the order closes on its own and cannot be received.
    const PO = mongoose.model('PurchaseOrder');
    let closed = await PO.findById(po._id).lean();
    expect(closed.status).toBe('Complete');
    expect(closed.closedByBill).toBe(second.billNumber);
    const rcv = await auth('post', `/api/purchase-orders/${po._id}/receive`, tok).send({ received: [] });
    expect(rcv.status).toBe(409);
    // Saving the same number again is fine; taking it off reopens the order.
    expect((await auth('patch', `/api/bills/${second._id}/po-number`, tok).send({ poNumber: 'po-test-link' })).status).toBe(200);
    expect((await auth('patch', `/api/bills/${second._id}/po-number`, tok).send({ poNumber: '' })).status).toBe(200);
    closed = await PO.findById(po._id).lean();
    expect([closed.status, closed.closedByBill]).toEqual(['Ordered', '']);
    await auth('patch', `/api/bills/${second._id}/po-number`, tok).send({ poNumber: 'PO-TEST-LINK' });
    // A number that is no order here is kept as a reference.
    const first = await Bill.findOne({ supplierInvoiceNo: 'INV-PO-1' }).lean();
    const ref = await auth('patch', `/api/bills/${first._id}/po-number`, tok).send({ poNumber: 'PAPER-9' });
    expect(ref.body.linked).toBe(false);
    expect(ref.body.bill.purchaseOrderId).toBeNull();

    const list = await auth('get', '/api/purchase-orders', tok);
    const row = list.body.purchaseOrders.find(p => String(p._id) === String(po._id));
    expect(row.payables.map(b => b.billNumber)).toEqual([second.billNumber]);
  });

  it('a workbook row naming an open order links to it and closes it', async () => {
    const PO = mongoose.model('PurchaseOrder');
    const Bill = mongoose.model('Bill');
    const po = await PO.create({ poNumber: 'PO-TEST-WB', supplier: 'Acme Supplies', supplierId, status: 'Ordered', lines: [], estTotal: 250 });
    const imp = await auth('post', '/api/setup/open-payables/import', tok).send({ rows: [
      { supplier: 'Acme Supplies', invoiceNo: 'INV-PO-3', amountOwed: 250, poNumber: 'po-test-wb' },
    ] });
    expect(imp.body.created, JSON.stringify(imp.body)).toBe(1);
    const bill = await Bill.findOne({ supplierInvoiceNo: 'INV-PO-3' }).lean();
    expect(String(bill.purchaseOrderId)).toBe(String(po._id));
    expect(bill.poNumber).toBe('PO-TEST-WB');
    const closed = await PO.findById(po._id).lean();
    expect([closed.status, closed.closedByBill]).toEqual(['Complete', bill.billNumber]);
  });

  it('a pending typed-in bill leaves its order open, and becomes the payable when the order is received', async () => {
    const PO = mongoose.model('PurchaseOrder');
    const Bill = mongoose.model('Bill');
    const po = await PO.create({ poNumber: 'PO-TEST-PEND', supplier: 'Acme Supplies', supplierId, status: 'Processing',
      lines: [{ invId: inv._id, itemName: 'Widget', unit: 'pcs', orderedQty: 10, unitCost: 5 }], estTotal: 50 });
    const made = await carriedIn({ description: 'Typed in ahead of delivery', amount: 50, expenseAccountCode: '130000' });
    const id = made.body.bill._id;
    expect((await auth('patch', `/api/bills/${id}/po-number`, tok).send({ poNumber: 'PO-TEST-PEND' })).body.linked).toBe(true);
    // Not received, so not closed.
    expect((await PO.findById(po._id).lean()).status).toBe('Processing');

    // One order, one linked bill.
    const other = await carriedIn({ description: 'Another', amount: 50, expenseAccountCode: '130000' });
    const second = await auth('patch', `/api/bills/${other.body.bill._id}/po-number`, tok).send({ poNumber: 'PO-TEST-PEND' });
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/already linked/i);

    // Approving it before the delivery would book the payable twice.
    const early = await auth('post', `/api/bills/${id}/approve`, tok).send({});
    expect(early.status).toBe(409);
    expect(early.body.error).toMatch(/not been received/i);

    // Receiving raises no second bill: the typed-in one is the delivery's payable.
    const before = await Bill.countDocuments({});
    const rcv = await auth('post', `/api/purchase-orders/${po._id}/receive`, tok).send({ received: [{ index: 0, receivedQty: 10 }] });
    expect(rcv.status, JSON.stringify(rcv.body)).toBe(200);
    expect(await Bill.countDocuments({})).toBe(before);
    const bill = await Bill.findById(id).lean();
    expect([bill.source, bill.amount, String(bill.purchaseOrderId)]).toEqual(['PO', 50, String(po._id)]);
    expect((await PO.findById(po._id).lean()).status).toBe('Complete');
  });

  it('rejecting a pending linked bill frees the order for another', async () => {
    const PO = mongoose.model('PurchaseOrder');
    const po = await PO.create({ poNumber: 'PO-TEST-REJ', supplier: 'Acme Supplies', supplierId, status: 'Ordered', lines: [], estTotal: 300 });
    const a = await carriedIn({ description: 'First', amount: 300, expenseAccountCode: '520000' });
    expect((await auth('patch', `/api/bills/${a.body.bill._id}/po-number`, tok).send({ poNumber: 'PO-TEST-REJ' })).body.linked).toBe(true);
    expect((await auth('post', `/api/bills/${a.body.bill._id}/reject`, tok).send({ reason: 'Entered by mistake' })).status).toBe(200);
    const b = await carriedIn({ description: 'Second', amount: 300, expenseAccountCode: '520000' });
    expect((await auth('patch', `/api/bills/${b.body.bill._id}/po-number`, tok).send({ poNumber: 'PO-TEST-REJ' })).body.linked).toBe(true);
    expect((await PO.findById(po._id).lean()).status).toBe('Ordered');
  });

  it('a bill for a different amount than the order cannot be linked', async () => {
    await mongoose.model('PurchaseOrder').create({ poNumber: 'PO-TEST-AMT', supplier: 'Acme Supplies', supplierId, status: 'Ordered', lines: [], estTotal: 1000 });
    const made = await carriedIn({ description: 'Not the same total', amount: 999, expenseAccountCode: '520000' });
    const r = await auth('patch', `/api/bills/${made.body.bill._id}/po-number`, tok).send({ poNumber: 'PO-TEST-AMT' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/same amount/i);
    expect((await mongoose.model('Bill').findById(made.body.bill._id).lean()).purchaseOrderId).toBeNull();
  });

  it('a bill typed in on screen cannot be given a PO number by hand', async () => {
    const made = await auth('post', '/api/bills', tok).send({ supplierId, description: 'Typed today', amount: 75, expenseAccountCode: '520000' });
    const r = await auth('patch', `/api/bills/${made.body.bill._id}/po-number`, tok).send({ poNumber: 'ANY-1' });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/setup workbook/i);
  });

  it('the workbook brings orders and their payables in together, already linked', async () => {
    const PO = mongoose.model('PurchaseOrder');
    const Bill = mongoose.model('Bill');
    const imp = await auth('post', '/api/setup/purchase-orders/import', tok).send({ rows: [
      { poNumber: 'PO-WB-9', supplier: 'Acme Supplies', orderDate: '2026-08-01', itemCode: 'WID-1', itemName: 'Widget', qty: 40, unitCost: 5 },
      { poNumber: 'PO-WB-9', itemName: 'Freight', qty: 1, unitCost: 50 },
      { poNumber: 'PO-WB-10', supplier: 'Nobody Known', itemName: 'X', qty: 1, unitCost: 1 },
    ] });
    expect(imp.status, JSON.stringify(imp.body)).toBe(200);
    expect(imp.body.created).toBe(1);
    expect(imp.body.skipped[0].error).toMatch(/No supplier named/);
    const po = await PO.findOne({ poNumber: 'PO-WB-9' }).lean();
    expect([po.status, po.estTotal, po.lines.length, String(po.lines[0].invId)]).toEqual(['Ordered', 250, 2, String(inv._id)]);
    // the same file again adds nothing
    expect((await auth('post', '/api/setup/purchase-orders/import', tok).send({ rows: [{ poNumber: 'po-wb-9', supplier: 'Acme Supplies', itemName: 'Widget', qty: 1, unitCost: 1 }] })).body.created).toBe(0);
    // its opening payable, same total: linked, and the order closes
    const pay = await auth('post', '/api/setup/open-payables/import', tok).send({ rows: [{ supplier: 'Acme Supplies', invoiceNo: 'INV-WB-9', amountOwed: 250, poNumber: 'PO-WB-9' }] });
    expect(pay.body.created, JSON.stringify(pay.body)).toBe(1);
    const bill = await Bill.findOne({ supplierInvoiceNo: 'INV-WB-9' }).lean();
    expect([String(bill.purchaseOrderId), bill.imported]).toEqual([String(po._id), true]);
    expect((await PO.findById(po._id).lean()).status).toBe('Complete');
  });

  it('receiving an order line carried in without its stock item finds the item by code', async () => {
    const PO = mongoose.model('PurchaseOrder');
    const po = await PO.create({ poNumber: 'PO-TEST-NOINV', supplier: 'Acme Supplies', supplierId, status: 'Ordered', estTotal: 20,
      lines: [{ purchaseType: 'inventory', invId: null, itemCode: 'wid-1', itemName: 'Widget', unit: 'pcs', orderedQty: 4, unitCost: 5 }] });
    const before = (await mongoose.model('Inventory').findById(inv._id).lean()).stockQty;
    const rcv = await auth('post', `/api/purchase-orders/${po._id}/receive`, tok).send({ received: [{ index: 0, receivedQty: 4 }] });
    expect(rcv.status, JSON.stringify(rcv.body)).toBe(200);
    expect((await mongoose.model('Inventory').findById(inv._id).lean()).stockQty).toBe(before + 4);
  });

  it('a bill raised from one of our own POs keeps its number', async () => {
    const Bill = mongoose.model('Bill');
    const own = await Bill.findOne({ source: 'PO' }).lean();
    if (!own) return;
    const r = await auth('patch', `/api/bills/${own._id}/po-number`, tok).send({ poNumber: 'X' });
    expect(r.status).toBe(409);
  });
});
