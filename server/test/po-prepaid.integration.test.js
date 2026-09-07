// A purchase order paid BEFORE delivery is not a payable.
//
// Nothing is owed at that point - the supplier owes us goods - so the money
// sits as a supplier advance (170200, an asset). Recording it as A/P would
// show money owed on an order already settled, and once the cash had also left
// the books would understate what the business holds.
//
//   pay now   DR 170200 Advances to Suppliers   CR cash
//   receive   DR 130000 Inventory               CR 170200   (liquidation)
//
// Receiving must therefore clear the advance, not credit A/P a second time.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'PrepaySuper', role: 'superadmin' });
  tok = await loginStaff(app, 'PrepaySuper');
}, 120000);

afterAll(async () => { await ctx.stop(); });

const M = (n) => mongoose.model(n);
const line = (je, code) => je.lines.find(l => l.accountCode === code);
const creditsOn = async (code) => {
  const es = await M('JournalEntry').find({ 'lines.accountCode': code }).lean();
  return es.reduce((s, e) => s + (line(e, code)?.credit || 0), 0);
};

let beans;
beforeEach(async () => {
  for (const n of ['PurchaseOrder', 'JournalEntry', 'Advance', 'CheckVoucher', 'Inventory', 'StockCard']) {
    await M(n).deleteMany({});
  }
  beans = await M('Inventory').create({
    itemCode: 'RM-BEAN', itemName: 'Coffee Beans', unit: 'g',
    stockQty: 0, unitCost: 0, unitMultiplier: 1,
  });
});

// 10 packs at P500 = P5,000.
const makePO = (over = {}) => auth('post', '/api/purchase-orders').send({
  supplier: 'Metro Beans',
  lines: [{ invId: String(beans._id), itemName: 'Coffee Beans', unit: 'g', packSize: 1000, orderedQty: 10, unitCost: 500 }],
  ...over,
});

const receiveAll = (po) => auth('post', `/api/purchase-orders/${po._id}/receive`)
  .send({ received: [{ index: 0, receivedQty: 10 }] });

describe('paying a purchase order up front', () => {
  it('books a supplier advance instead of a payable', async () => {
    const res = await makePO({ prepaid: true, prepaidFromAccount: '111000', prepaidDate: '2026-03-10' });
    expect(res.status).toBe(201);
    expect(res.body.advance).toBeTruthy();
    expect(res.body.advance.amount).toBe(5000);

    const je = await M('JournalEntry').findOne({ reference: /^ADV-JE/ }).lean();
    expect(line(je, '170200').debit).toBe(5000);   // the asset we now hold
    expect(line(je, '111000').credit).toBe(5000);  // the cash that left
    expect(line(je, '220000')).toBeUndefined();    // nothing is owed
    expect(je.totalDebit).toBeCloseTo(je.totalCredit, 2);
  }, 30000);

  it('honours the date the money actually moved', async () => {
    await makePO({ prepaid: true, prepaidDate: '2026-03-10' });
    const adv = await M('Advance').findOne({}).lean();
    // Filed later, but it belongs in March.
    expect(new Date(adv.date).getMonth()).toBe(2);
  }, 30000);

  it('issues a Check Voucher, because real cash left', async () => {
    await makePO({ prepaid: true });
    const cv = await M('CheckVoucher').findOne({}).lean();
    expect(cv).toBeTruthy();
    expect(cv.amount).toBe(5000);
    expect(cv.payeeName).toBe('Metro Beans');
  }, 30000);

  it('creates a supplier-type advance tied to the PO', async () => {
    const { body } = await makePO({ prepaid: true });
    const adv = await M('Advance').findById(body.advance._id).lean();
    expect(adv.type).toBe('supplier');
    expect(adv.account).toBe('170200');
    expect(adv.referenceNumber).toBe(body.purchaseOrder.poNumber);
  }, 30000);

  it('does none of this for an ordinary order on account', async () => {
    const res = await makePO();
    expect(res.body.advance).toBeNull();
    expect(await M('Advance').countDocuments({})).toBe(0);
  }, 30000);
});

describe('receiving a prepaid order', () => {
  it('clears the advance rather than crediting payables again', async () => {
    const { body } = await makePO({ prepaid: true });
    await receiveAll(body.purchaseOrder);

    const rcv = await M('JournalEntry').findOne({ reference: /^PO-RCV/ }).lean();
    expect(line(rcv, '130000').debit).toBe(5000);
    expect(line(rcv, '170200').credit).toBe(5000);
    // The failure this prevents: money owed on an order already paid for.
    expect(line(rcv, '220000')).toBeUndefined();
    expect(await creditsOn('220000')).toBe(0);
  }, 60000);

  it('marks the advance liquidated once the goods arrive', async () => {
    const { body } = await makePO({ prepaid: true });
    await receiveAll(body.purchaseOrder);

    const adv = await M('Advance').findById(body.advance._id).lean();
    expect(adv.liquidatedAmount).toBe(5000);
    expect(adv.status).toBe('Liquidated');
    expect(adv.liquidations).toHaveLength(1);
  }, 60000);

  it('leaves the advance partly open on a short delivery', async () => {
    const { body } = await makePO({ prepaid: true });
    await auth('post', `/api/purchase-orders/${body.purchaseOrder._id}/receive`)
      .send({ received: [{ index: 0, receivedQty: 6 }] });

    const adv = await M('Advance').findById(body.advance._id).lean();
    expect(adv.liquidatedAmount).toBe(3000);
    expect(adv.status).toBe('Partially Liquidated');
    // The rest is still money the supplier owes us in goods.
    expect(adv.amount - adv.liquidatedAmount).toBe(2000);
  }, 60000);

  it('never writes the advance past what was prepaid', async () => {
    // Prepay for less than the order, then take the whole delivery.
    const { body } = await makePO({ prepaid: true, prepaidAmount: 2000 });
    await receiveAll(body.purchaseOrder);

    const adv = await M('Advance').findById(body.advance._id).lean();
    expect(adv.liquidatedAmount).toBe(2000);
    expect(adv.liquidatedAmount).toBeLessThanOrEqual(adv.amount);
    expect(adv.status).toBe('Liquidated');
  }, 60000);

  it('still credits payables on an ordinary order', async () => {
    const { body } = await makePO();
    await receiveAll(body.purchaseOrder);
    const rcv = await M('JournalEntry').findOne({ reference: /^PO-RCV/ }).lean();
    expect(line(rcv, '220000').credit).toBe(5000);
    expect(line(rcv, '170200')).toBeUndefined();
  }, 60000);
});
