// Three-way match: PO + receiving report + supplier invoice must agree before a
// bill for received goods is released for payment. An exception goes back to
// procurement, or is accepted - with a reason, by someone allowed to approve
// price changes - and the difference is booked. The same supplier invoice can
// never be entered twice.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff, trialBalance } from './helpers/harness.js';

let ctx, app, supplierId, inv;
const tok = {};
const as = (t, m, p) => request(app)[m](p).set('Authorization', `Bearer ${t}`);
const M = (n) => mongoose.model(n);

const receive = async ({ ordered = 10, received = 10, unitCost = 50 } = {}) => {
  const po = await as(tok.super, 'post', '/api/purchase-orders').send({
    supplier: 'Metro Packaging', supplierId,
    lines: [{ invId: String(inv._id), itemName: 'Cups', itemCode: 'CUP', unit: 'pcs', orderedQty: ordered, unitCost }],
  });
  const rcv = await as(tok.super, 'post', `/api/purchase-orders/${po.body.purchaseOrder._id}/receive`).send({ received: [{ index: 0, receivedQty: received }] });
  expect(rcv.status, JSON.stringify(rcv.body)).toBe(200);
  return rcv.body.bill;
};
let invSeq = 0;
const invoiceNo = () => `INV-${++invSeq}`;

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'twSuper', role: 'superadmin' });
  // Posts the books but may not approve price changes.
  await makeUser({ name: 'twClerk', role: 'staff', permissions: ['accounting.view', 'accounting.manage'] });
  tok.super = await loginStaff(app, 'twSuper');
  tok.clerk = await loginStaff(app, 'twClerk');
  supplierId = String((await M('Supplier').create({ name: 'Metro Packaging' }))._id);
  inv = await M('Inventory').create({ itemName: 'Cups', itemCode: 'CUP', stockQty: 0, unit: 'pcs', unitCost: 50 });
}, 120000);
afterAll(async () => { await ctx.stop(); });

describe('three-way match', () => {
  it('a matching invoice releases the bill for payment', async () => {
    const bill = await receive();
    const r = await as(tok.clerk, 'post', `/api/bills/${bill._id}/invoice`).send({ supplierInvoiceNo: invoiceNo(), invoiceAmount: 500, invoiceDate: '2026-09-20' });
    expect(r.status).toBe(200);
    expect(r.body.match).toMatchObject({ status: 'Matched', poValue: 500, receivedValue: 500, invoiceAmount: 500 });
    const ok = await as(tok.clerk, 'post', `/api/bills/${bill._id}/approve`).send({});
    expect(ok.status).toBe(200);
    expect(ok.body.bill.status).toBe('Approved');
  });

  it('an invoice that differs is an exception the clerk cannot wave through', async () => {
    const bill = await receive();
    const r = await as(tok.clerk, 'post', `/api/bills/${bill._id}/invoice`).send({ supplierInvoiceNo: invoiceNo(), invoiceAmount: 560 });
    expect(r.body.match.status).toBe('Exception');
    expect(r.body.match.variance).toBe(60);
    const plain = await as(tok.clerk, 'post', `/api/bills/${bill._id}/approve`).send({});
    expect(plain.status).toBe(409);
    expect(plain.body.matchException).toBe(true);
    const clerkAccept = await as(tok.clerk, 'post', `/api/bills/${bill._id}/approve`).send({ acceptVariance: true, acceptReason: 'agreed surcharge' });
    expect(clerkAccept.status).toBe(403);
    const noReason = await as(tok.super, 'post', `/api/bills/${bill._id}/approve`).send({ acceptVariance: true });
    expect(noReason.status).toBe(400);
  });

  it('an accepted difference re-states the payable and books the variance', async () => {
    const bill = await receive();
    await as(tok.super, 'post', `/api/bills/${bill._id}/invoice`).send({ supplierInvoiceNo: invoiceNo(), invoiceAmount: 560 });
    const ok = await as(tok.super, 'post', `/api/bills/${bill._id}/approve`).send({ acceptVariance: true, acceptReason: 'fuel surcharge agreed by phone' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.bill.amount).toBe(560);
    expect(ok.body.bill.match).toMatchObject({ status: 'Accepted', acceptedBy: 'twSuper' });
    const je = await M('JournalEntry').findOne({ reference: ok.body.bill.match.varianceJournalRef }).lean();
    expect(je.lines.find(l => l.accountCode === '525000').debit).toBe(60);
    expect(je.lines.find(l => l.accountCode === '220000').credit).toBe(60);
    const tb = await trialBalance();
    expect(tb.debits).toBeCloseTo(tb.credits, 2);
  });

  it('a PO received in two parts matches each delivery against itself', async () => {
    const po = (await as(tok.super, 'post', '/api/purchase-orders').send({
      supplier: 'Metro Packaging', supplierId,
      lines: [{ invId: String(inv._id), itemName: 'Cups', itemCode: 'CUP', unit: 'pcs', orderedQty: 10, unitCost: 50 }],
    })).body.purchaseOrder;
    const first = (await as(tok.super, 'post', `/api/purchase-orders/${po._id}/receive`).send({ received: [{ index: 0, receivedQty: 6 }] })).body.bill;
    const m1 = await as(tok.clerk, 'post', `/api/bills/${first._id}/invoice`).send({ supplierInvoiceNo: invoiceNo(), invoiceAmount: 300 });
    expect(m1.body.match).toMatchObject({ status: 'Matched', poValue: 300 });
    const second = (await as(tok.super, 'post', `/api/purchase-orders/${po._id}/receive`).send({ received: [{ index: 0, receivedQty: 4 }] })).body.bill;
    expect(second.amount).toBe(200);
    const m2 = await as(tok.clerk, 'post', `/api/bills/${second._id}/invoice`).send({ supplierInvoiceNo: invoiceNo(), invoiceAmount: 200 });
    // It used to be compared with both deliveries together (P500) and flagged.
    expect(m2.body.match).toMatchObject({ status: 'Matched', poValue: 200, receivedValue: 200 });
    const ok = await as(tok.clerk, 'post', `/api/bills/${second._id}/approve`).send({});
    expect(ok.status).toBe(200);
  });

  it('an over-receipt is an exception even when the money agrees', async () => {
    const bill = await receive({ ordered: 10, received: 12 });
    const r = await as(tok.super, 'post', `/api/bills/${bill._id}/invoice`).send({ supplierInvoiceNo: invoiceNo(), invoiceAmount: 600 });
    expect(r.body.match.status).toBe('Exception');
    expect(r.body.match.issues.map(i => i.code)).toContain('over_receipt');
  });
});

describe('duplicate supplier invoices', () => {
  it('the same invoice number cannot be matched to a second bill', async () => {
    const a = await receive();
    const b = await receive();
    await as(tok.super, 'post', `/api/bills/${a._id}/invoice`).send({ supplierInvoiceNo: 'MP-7788', invoiceAmount: 500 });
    const dupe = await as(tok.super, 'post', `/api/bills/${b._id}/invoice`).send({ supplierInvoiceNo: 'mp 7788', invoiceAmount: 500 });
    expect(dupe.status).toBe(409);
    expect(dupe.body.error).toMatch(/already on bill/);
  });

  it('a manual bill and a bill import refuse an invoice already entered', async () => {
    const make = (no) => as(tok.super, 'post', '/api/bills').send({ supplierId, description: 'Repairs', amount: 1000, expenseAccountCode: '690000', supplierInvoiceNo: no });
    expect((await make('MAN-1')).status).toBe(200);
    const again = await make('man-1');
    expect(again.status).toBe(409);
    const imp = await as(tok.super, 'post', '/api/bills/import').send({ rows: [
      { supplier: 'Metro Packaging', description: 'Repairs', amount: 1000, expenseAccountCode: '690000', supplierInvoiceNo: 'MAN-1' },
      { supplier: 'Metro Packaging', description: 'Other', amount: 200, expenseAccountCode: '690000', supplierInvoiceNo: 'MAN-2' },
    ] });
    expect(imp.body.created).toBe(1);
    expect(imp.body.skipped[0].error).toMatch(/already on bill/);
  });

  it('a rejected bill frees its invoice number', async () => {
    const make = (no) => as(tok.super, 'post', '/api/bills').send({ supplierId, description: 'Service', amount: 300, expenseAccountCode: '690000', supplierInvoiceNo: no });
    const first = await make('REJ-1');
    await as(tok.super, 'post', `/api/bills/${first.body.bill._id}/reject`).send({ reason: 'wrong supplier' });
    expect((await make('REJ-1')).status).toBe(200);
  });
});
