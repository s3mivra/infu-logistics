// Overpayment / partial-payment / credit-balance handling on both sides of
// the books:
//   AR: a client who pays MORE than an order's outstanding balance gets the
//       excess parked as their OWN stored credit (260100), which can later
//       be applied to a different order or refunded out via a Check Voucher.
//   AP: paying a bill for MORE than it owes parks the excess as the
//       supplier's credit (160100), same shape, applicable to a later bill.
//   AP: a bill can now be paid in installments (Partially Paid), not just
//       all-or-nothing.
// Every real payment (bill payment, credit refund) issues a Check Voucher -
// the actual paper trail, independent of which record it was posted against.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, superTok;
const auth = (m, p, t) => request(app)[m](p).set('Authorization', `Bearer ${t}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'OverpaySuper', role: 'superadmin' });
  superTok = await loginStaff(app, 'OverpaySuper');
}, 120000);

afterAll(async () => { await ctx.stop(); });

async function makeCompletedOrder(total, clientId) {
  const Order = mongoose.model('Order');
  return Order.create({
    orderNumber: `OVP-${Math.random().toString(36).slice(2, 8)}`,
    status: 'Completed', isComplimentary: false,
    total, subtotal: total, discount: 0, paymentMethod: 'Bank Transfer',
    clientId: clientId ? String(clientId) : '',
  });
}

describe('A/R overpayment - becomes stored client credit', () => {
  it('rejects an overpayment on an order with no linked client account (nowhere for the excess to live)', async () => {
    const order = await makeCompletedOrder(500); // no clientId
    const res = await auth('post', `/api/orders/${order._id}/settle-ar`, superTok)
      .send({ amount: 800, paymentMethod: 'Bank Transfer', referenceNumber: 'BANK-1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no client account/i);
  });

  it('an overpayment on a client-linked order settles the order in full and credits the excess to the client', async () => {
    const ClientAccount = mongoose.model('ClientAccount');
    const client = await ClientAccount.create({ clientCode: 'OVP-C1', username: 'ovp_client1', name: 'Overpay Client 1', password: 'x', paymentMethod: 'Cash', isActive: true });
    const order = await makeCompletedOrder(500, client._id);

    const res = await auth('post', `/api/orders/${order._id}/settle-ar`, superTok)
      .send({ amount: 800, paymentMethod: 'Bank Transfer', referenceNumber: 'BANK-2' });
    expect(res.status).toBe(200);
    expect(res.body.fullySettled).toBe(true);
    expect(res.body.overpay).toBe(300);
    expect(res.body.balance).toBe(0);

    const updated = await ClientAccount.findById(client._id).lean();
    expect(updated.creditBalance).toBe(300);
    expect(updated.creditHistory).toHaveLength(1);
    expect(updated.creditHistory[0].type).toBe('overpayment');

    const je = await mongoose.model('JournalEntry').findOne({ description: new RegExp(order.orderNumber) }).lean();
    expect(je.lines.some(l => l.accountCode === '260100' && l.credit === 300)).toBe(true);
    expect(je.lines.some(l => l.accountCode === '120000' && l.credit === 500)).toBe(true);
    expect(je.totalDebit).toBeCloseTo(je.totalCredit, 2);
  });

  it('client credit can be applied to a DIFFERENT order, no cash involved', async () => {
    const ClientAccount = mongoose.model('ClientAccount');
    const client = await ClientAccount.create({ clientCode: 'OVP-C2', username: 'ovp_client2', name: 'Overpay Client 2', password: 'x', paymentMethod: 'Cash', isActive: true, creditBalance: 200 });
    const order = await makeCompletedOrder(150, client._id);

    const res = await auth('post', `/api/client-accounts/${client._id}/credit/apply`, superTok)
      .send({ orderId: order._id, amount: 150 });
    expect(res.status).toBe(200);
    expect(res.body.balance).toBe(0);
    expect(res.body.client.creditBalance).toBe(50);

    const updatedOrder = await mongoose.model('Order').findById(order._id).lean();
    expect(updatedOrder.arSettled).toBe(true);
    expect(updatedOrder.arPayments.some(p => p.paymentMethod === 'Client Credit')).toBe(true);
  });

  // The A/R worklist carries each client's stored credit so the table can offer
  // "apply credit" per invoice without a lookup per row.
  it('exposes the client stored credit on the A/R outstanding worklist', async () => {
    const ClientAccount = mongoose.model('ClientAccount');
    const client = await ClientAccount.create({ clientCode: 'OVP-C5', username: 'ovp_client5', name: 'Overpay Client 5', password: 'x', paymentMethod: 'Cash', isActive: true, creditBalance: 275 });
    const order = await makeCompletedOrder(400, client._id);

    const res = await auth('get', '/api/finance/ar-outstanding', superTok);
    expect(res.status).toBe(200);
    const row = res.body.orders.find(o => String(o._id) === String(order._id));
    expect(row).toBeTruthy();
    expect(row.clientCredit).toBe(275);
    expect(String(row.clientId)).toBe(String(client._id));
  });

  it('reports zero stored credit for an order with no client account', async () => {
    const order = await makeCompletedOrder(300); // no clientId
    const res = await auth('get', '/api/finance/ar-outstanding', superTok);
    const row = res.body.orders.find(o => String(o._id) === String(order._id));
    expect(row.clientCredit).toBe(0);
  });

  it('cannot apply more credit than the client actually has', async () => {
    const ClientAccount = mongoose.model('ClientAccount');
    const client = await ClientAccount.create({ clientCode: 'OVP-C3', username: 'ovp_client3', name: 'Overpay Client 3', password: 'x', paymentMethod: 'Cash', isActive: true, creditBalance: 10 });
    const order = await makeCompletedOrder(500, client._id);
    const res = await auth('post', `/api/client-accounts/${client._id}/credit/apply`, superTok)
      .send({ orderId: order._id, amount: 100 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/only.*10\.00.*available/i);
  });

  it('client credit can be refunded out via a real Check Voucher', async () => {
    const ClientAccount = mongoose.model('ClientAccount');
    const client = await ClientAccount.create({ clientCode: 'OVP-C4', username: 'ovp_client4', name: 'Overpay Client 4', password: 'x', paymentMethod: 'Cash', isActive: true, creditBalance: 400 });

    const res = await auth('post', `/api/client-accounts/${client._id}/credit/refund`, superTok)
      .send({ amount: 400, sourceAccount: '111000', referenceNumber: 'REFUND-1' });
    expect(res.status).toBe(200);
    expect(res.body.voucher.voucherNumber).toMatch(/^CV-/);
    expect(res.body.voucher.payeeType).toBe('client');
    expect(res.body.voucher.purpose).toBe('client-credit-refund');
    expect(res.body.client.creditBalance).toBe(0);

    const updated = await ClientAccount.findById(client._id).lean();
    expect(updated.creditBalance).toBe(0);
    expect(updated.creditHistory.some(h => h.type === 'refunded')).toBe(true);
  });
});

describe('A/P: partial bill payment', () => {
  async function makeApprovedBill(amount) {
    const Supplier = mongoose.model('Supplier');
    const supplier = await Supplier.create({ name: `AP Supplier ${Math.random().toString(36).slice(2, 6)}` });
    const created = await auth('post', '/api/bills', superTok).send({
      supplierId: supplier._id, description: 'Test bill', amount, expenseAccountCode: '520000',
    });
    await auth('post', `/api/bills/${created.body.bill._id}/approve`, superTok).send({});
    return { billId: created.body.bill._id, supplier };
  }

  it('a payment less than the bill amount moves it to Partially Paid, not Paid', async () => {
    const { billId } = await makeApprovedBill(1000);
    const res = await auth('post', `/api/bills/${billId}/pay`, superTok).send({ amount: 400, payFromAccount: '111000' });
    expect(res.status).toBe(200);
    expect(res.body.bill.status).toBe('Partially Paid');
    expect(res.body.bill.paidAmount).toBe(400);
    expect(res.body.voucher.amount).toBe(400);
  });

  it('a second payment for the rest completes it', async () => {
    const { billId } = await makeApprovedBill(1000);
    await auth('post', `/api/bills/${billId}/pay`, superTok).send({ amount: 400, payFromAccount: '111000' });
    const res = await auth('post', `/api/bills/${billId}/pay`, superTok).send({ amount: 600, payFromAccount: '111000' });
    expect(res.status).toBe(200);
    expect(res.body.bill.status).toBe('Paid');
    expect(res.body.bill.paidAmount).toBe(1000);
    expect(res.body.bill.payments).toHaveLength(2);
  });

  it('omitting amount pays the full remaining balance (old one-shot behavior still works)', async () => {
    const { billId } = await makeApprovedBill(750);
    const res = await auth('post', `/api/bills/${billId}/pay`, superTok).send({ payFromAccount: '111000' });
    expect(res.status).toBe(200);
    expect(res.body.bill.status).toBe('Paid');
    expect(res.body.bill.paidAmount).toBe(750);
  });

  it('cannot pay an already fully-paid bill again', async () => {
    const { billId } = await makeApprovedBill(300);
    await auth('post', `/api/bills/${billId}/pay`, superTok).send({ payFromAccount: '111000' });
    const res = await auth('post', `/api/bills/${billId}/pay`, superTok).send({ amount: 1, payFromAccount: '111000' });
    expect(res.status).toBe(409);
  });
});

describe('A/P overpayment - becomes stored supplier credit', () => {
  async function makeApprovedBill(amount) {
    const Supplier = mongoose.model('Supplier');
    const supplier = await Supplier.create({ name: `AP Overpay Supplier ${Math.random().toString(36).slice(2, 6)}` });
    const created = await auth('post', '/api/bills', superTok).send({
      supplierId: supplier._id, description: 'Test bill', amount, expenseAccountCode: '520000',
    });
    await auth('post', `/api/bills/${created.body.bill._id}/approve`, superTok).send({});
    return { billId: created.body.bill._id, supplier };
  }

  it('paying more than the bill owes fully settles it and credits the supplier for the rest', async () => {
    const { billId, supplier } = await makeApprovedBill(500);
    const res = await auth('post', `/api/bills/${billId}/pay`, superTok).send({ amount: 800, payFromAccount: '111000' });
    expect(res.status).toBe(200);
    expect(res.body.bill.status).toBe('Paid');
    expect(res.body.bill.paidAmount).toBe(500); // capped at the bill's own amount, not the cash paid
    expect(res.body.overpay).toBe(300);

    const Supplier = mongoose.model('Supplier');
    const updated = await Supplier.findById(supplier._id).lean();
    expect(updated.creditBalance).toBe(300);
    expect(updated.creditHistory[0].type).toBe('overpayment');

    const je = await mongoose.model('JournalEntry').findOne({ reference: res.body.voucher.journalEntryRef }).lean();
    expect(je.lines.some(l => l.accountCode === '160100' && l.debit === 300)).toBe(true);
    expect(je.totalDebit).toBeCloseTo(je.totalCredit, 2);
  });

  it('supplier credit can be applied to a DIFFERENT bill, no cash involved', async () => {
    const Supplier = mongoose.model('Supplier');
    const supplier = await Supplier.create({ name: 'AP Credit Apply Supplier', creditBalance: 200 });
    const created = await auth('post', '/api/bills', superTok).send({
      supplierId: supplier._id, description: 'Another bill', amount: 150, expenseAccountCode: '520000',
    });
    await auth('post', `/api/bills/${created.body.bill._id}/approve`, superTok).send({});

    const res = await auth('post', `/api/suppliers/${supplier._id}/credit/apply`, superTok)
      .send({ billId: created.body.bill._id, amount: 150 });
    expect(res.status).toBe(200);
    expect(res.body.bill.status).toBe('Paid');
    expect(res.body.supplier.creditBalance).toBe(50);
  });

  it('cannot apply more supplier credit than is available', async () => {
    const Supplier = mongoose.model('Supplier');
    const supplier = await Supplier.create({ name: 'AP Credit Limit Supplier', creditBalance: 20 });
    const created = await auth('post', '/api/bills', superTok).send({
      supplierId: supplier._id, description: 'Bill', amount: 500, expenseAccountCode: '520000',
    });
    await auth('post', `/api/bills/${created.body.bill._id}/approve`, superTok).send({});
    const res = await auth('post', `/api/suppliers/${supplier._id}/credit/apply`, superTok)
      .send({ billId: created.body.bill._id, amount: 100 });
    expect(res.status).toBe(400);
  });
});

describe('Check Vouchers', () => {
  it('lists issued vouchers and can void one', async () => {
    const ClientAccount = mongoose.model('ClientAccount');
    const client = await ClientAccount.create({ clientCode: 'OVP-CV1', username: 'ovp_cv1', name: 'CV Test Client', password: 'x', paymentMethod: 'Cash', isActive: true, creditBalance: 50 });
    const refund = await auth('post', `/api/client-accounts/${client._id}/credit/refund`, superTok).send({ amount: 50 });
    const voucherId = refund.body.voucher._id;

    const list = await auth('get', '/api/check-vouchers', superTok);
    expect(list.status).toBe(200);
    expect(list.body.vouchers.some(v => v._id === voucherId)).toBe(true);

    const voidRes = await auth('post', `/api/check-vouchers/${voucherId}/void`, superTok).send({ reason: 'printed wrong' });
    expect(voidRes.status).toBe(200);
    expect(voidRes.body.voucher.status).toBe('Voided');

    const again = await auth('post', `/api/check-vouchers/${voucherId}/void`, superTok).send({ reason: 'x' });
    expect(again.status).toBe(409);
  });

  it('requires a reason to void', async () => {
    const ClientAccount = mongoose.model('ClientAccount');
    const client = await ClientAccount.create({ clientCode: 'OVP-CV2', username: 'ovp_cv2', name: 'CV Test Client 2', password: 'x', paymentMethod: 'Cash', isActive: true, creditBalance: 10 });
    const refund = await auth('post', `/api/client-accounts/${client._id}/credit/refund`, superTok).send({ amount: 10 });
    const res = await auth('post', `/api/check-vouchers/${refund.body.voucher._id}/void`, superTok).send({});
    expect(res.status).toBe(400);
  });
});
