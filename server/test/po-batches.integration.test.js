// Two batches of the same product on one purchase order - same delivery,
// different expiry. Each line is received on its own, so each goes into stock
// as its own batch with its own date.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok, invId;
const auth = () => ({ Authorization: `Bearer ${tok}` });

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'PoBatchBoss', role: 'superadmin' });
  tok = await loginStaff(app, 'PoBatchBoss');
  const inv = await mongoose.model('Inventory').create({
    itemCode: 'OAT-1', itemName: 'OATSIDE BARISTA EDITION', stockQty: 0, unit: 'ml',
    unitCost: 0, displayUnit: 'L', unitMultiplier: 1000, packSize: 1, businessType: 'log',
  });
  invId = String(inv._id);
}, 120000);
afterAll(async () => { await ctx.stop(); });

describe('one product, two batches on a purchase order', () => {
  it('each batch goes into stock with its own expiry', async () => {
    const line = { invId, itemName: 'OATSIDE BARISTA EDITION', unit: 'L', packSize: 1, unitCost: 115 };
    const created = await request(app).post('/api/purchase-orders').set(auth()).send({
      supplier: 'Oat Supplier',
      lines: [
        { ...line, orderedQty: 10, expiryDate: '2027-03-31' },
        { ...line, orderedQty: 6, expiryDate: '2027-05-31' },
      ],
    });
    expect(created.body.success, JSON.stringify(created.body)).toBe(true);
    const po = created.body.purchaseOrder;
    expect(po.lines).toHaveLength(2);

    const r = await request(app).post(`/api/purchase-orders/${po._id}/receive`).set(auth()).send({ received: [
      { lineId: po.lines[0]._id, receivedQty: 10, expiryDate: '2027-03-31' },
      { lineId: po.lines[1]._id, receivedQty: 6, expiryDate: '2027-05-31' },
    ] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);

    const item = await mongoose.model('Inventory').findById(invId).lean();
    expect(item.stockQty).toBe(16000);   // 16 L, in ml
    const batches = (item.expiryBatches || []).map(b => [new Date(b.expiryDate).toISOString().slice(0, 10), b.qty]).sort();
    expect(batches).toEqual([['2027-03-31', 10000], ['2027-05-31', 6000]]);
    // The soonest one is what the expiry warning watches.
    expect(new Date(item.expiryDate).toISOString().slice(0, 10)).toBe('2027-03-31');
  });
});

describe('paid on delivery', () => {
  const netOf = async (code) => {
    const rows = await mongoose.model('JournalEntry').aggregate([{ $unwind: '$lines' }, { $match: { 'lines.accountCode': code } },
      { $group: { _id: null, d: { $sum: '$lines.debit' }, c: { $sum: '$lines.credit' } } }]);
    return rows[0] ? Math.round((rows[0].d - rows[0].c) * 100) / 100 : 0;
  };
  const make = (extra) => request(app).post('/api/purchase-orders').set(auth()).send({
    supplier: 'Syrup Co', lines: [{ invId, itemName: 'OATSIDE BARISTA EDITION', unit: 'L', packSize: 1, unitCost: 260, orderedQty: 12 }], ...extra,
  });

  it('pays for what arrived - 8 of 12 - from cash, owes nothing, raises no bill', async () => {
    const cash0 = await netOf('111000'), ap0 = await netOf('220000');
    const po = (await make({ payOnDelivery: true, payOnDeliveryAccount: '111000' })).body.purchaseOrder;
    expect(po.payOnDelivery).toBe(true);
    const r = await request(app).post(`/api/purchase-orders/${po._id}/receive`).set(auth())
      .send({ received: [{ lineId: po.lines[0]._id, receivedQty: 8 }] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.bill).toBeNull();
    expect(r.body.paidOnDelivery).toBe(2080);
    expect(Math.round((await netOf('111000') - cash0) * 100) / 100).toBe(-2080);
    expect(await netOf('220000')).toBe(ap0);
  });

  it('a normal order still goes on account, with a bill', async () => {
    const po = (await make({})).body.purchaseOrder;
    const r = await request(app).post(`/api/purchase-orders/${po._id}/receive`).set(auth())
      .send({ received: [{ lineId: po.lines[0]._id, receivedQty: 12 }] });
    expect(r.body.paidOnDelivery).toBe(0);
    expect(r.body.bill?.amount).toBe(3120);
  });

  it('refuses a pay-on-delivery account that is not cash, bank or e-wallet', async () => {
    const r = await make({ payOnDelivery: true, payOnDeliveryAccount: '220000' });
    expect(r.status).toBe(400);
  });
});

describe('pay on delivery through a requisition slip', () => {
  it('the approved PO is paid on delivery from the chosen account', async () => {
    const slip = await request(app).post('/api/requisition-slips').set(auth()).send({
      type: 'procurement', supplier: 'Syrup Co', payOnDelivery: true, payOnDeliveryAccount: '112000',
      lines: [{ invId, itemName: 'OATSIDE BARISTA EDITION', unit: 'L', packSize: 1, unitCost: 260, orderedQty: 12 }],
    });
    expect(slip.body.success, JSON.stringify(slip.body)).toBe(true);
    const ok = await request(app).post(`/api/requisition-slips/${slip.body.slip._id}/approve`).set(auth()).send({});
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const po = await mongoose.model('PurchaseOrder').findOne({ notes: new RegExp(slip.body.slip.slipNumber) }).lean();
    expect(po).toMatchObject({ payOnDelivery: true, payOnDeliveryAccount: '112000' });
  });
});
