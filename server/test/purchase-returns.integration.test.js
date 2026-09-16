// Sending goods back to a supplier.
//
// A delivery arrives damaged or wrong and goes back. Recording that as a plain
// inventory adjustment takes the stock out but leaves the supplier's invoice
// standing at the full amount: the business pays for goods it returned, and the
// missing stock shows as shrinkage it never suffered. A return has to move both
// sides - the stock AND what is owed - and give back any input VAT claimed on it.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok, supplier, item;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const M = (n) => mongoose.model(n);
const r2 = (n) => Math.round(n * 100) / 100;

// Net movement on an account: credits less debits.
const movement = async (code, ref) => {
  const q = { 'lines.accountCode': code, ...(ref ? { reference: ref } : {}) };
  const entries = await M('JournalEntry').find(q).lean();
  return r2(entries.reduce((sum, je) => sum + je.lines
    .filter(l => l.accountCode === code)
    .reduce((t, l) => t + (l.credit || 0) - (l.debit || 0), 0), 0));
};

// A PO for `qty` packs at `unitCost`, ordered and fully received.
const receivePO = async ({ qty = 10, unitCost = 100, claimInputVat = false } = {}) => {
  const created = await auth('post', '/api/purchase-orders').send({
    supplier: supplier.name, supplierId: String(supplier._id), status: 'Ordered',
    lines: [{ invId: String(item._id), itemName: item.itemName, unit: 'pcs', packSize: 1, orderedQty: qty, unitCost }],
  });
  const po = created.body.purchaseOrder;
  const res = await auth('post', `/api/purchase-orders/${po._id}/receive`)
    .send({ received: [{ index: 0, receivedQty: qty }], claimInputVat });
  return { po: res.body.purchaseOrder, bill: res.body.bill };
};

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'RetSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'RetSuper');
}, 120000);

afterAll(async () => { await ctx.stop(); });

beforeEach(async () => {
  await Promise.all([
    M('PurchaseOrder').deleteMany({}), M('Bill').deleteMany({}),
    M('JournalEntry').deleteMany({}), M('StockCard').deleteMany({}),
    M('Supplier').deleteMany({}), M('Inventory').deleteMany({}),
    M('Settings').deleteMany({ key: { $in: ['vatEnabled', 'vatRate', 'vatInclusive'] } }),
  ]);
  supplier = await M('Supplier').create({ name: 'Acme Supply' });
  item = await M('Inventory').create({ itemName: 'Boxes', unit: 'pcs', displayUnit: 'pcs', unitMultiplier: 1, stockQty: 0, unitCost: 0 });
});

describe('returning received goods', () => {
  it('takes the stock back out and shrinks what the supplier is owed', async () => {
    const { po, bill } = await receivePO({ qty: 10, unitCost: 100 });
    expect((await M('Inventory').findById(item._id).lean()).stockQty).toBe(10);
    expect(bill.amount).toBeCloseTo(1000, 2);

    const res = await auth('post', `/api/purchase-orders/${po._id}/return`)
      .send({ lines: [{ index: 0, qty: 3 }], reason: 'Crushed in transit' });
    expect(res.status).toBe(200);
    expect(res.body.debitMemo.amount).toBeCloseTo(300, 2);
    expect(res.body.debitMemo.appliedToBills).toBeCloseTo(300, 2);

    expect((await M('Inventory').findById(item._id).lean()).stockQty).toBe(7);
    expect((await M('Bill').findById(bill._id).lean()).amount).toBeCloseTo(700, 2);

    const fresh = await M('PurchaseOrder').findById(po._id).lean();
    expect(fresh.lines[0].returnedQty).toBe(3);
    expect(fresh.actualTotal).toBeCloseTo(700, 2);   // what we are keeping
  });

  it('posts a balanced entry that reverses the payable and the stock', async () => {
    const { po } = await receivePO({ qty: 10, unitCost: 100 });
    const res = await auth('post', `/api/purchase-orders/${po._id}/return`)
      .send({ lines: [{ index: 0, qty: 10 }], reason: 'Wrong item shipped' });
    const ref = res.body.debitMemo.returnNumber;

    const je = await M('JournalEntry').findOne({ reference: ref }).lean();
    expect(je.totalDebit).toBeCloseTo(je.totalCredit, 2);
    expect(await movement('220000', ref)).toBe(-1000);   // the payable is debited away
    expect(await movement('130000', ref)).toBe(1000);    // the stock is credited out

    // Across receipt and return together, neither side is left holding anything.
    expect(await movement('220000')).toBe(0);
    expect(await movement('130000')).toBe(0);
  });

  it('gives back exactly the input VAT that was claimed on the delivery', async () => {
    await M('Settings').updateOne({ key: 'vatEnabled' }, { $set: { value: true } }, { upsert: true });
    await M('Settings').updateOne({ key: 'vatRate' }, { $set: { value: 12 } }, { upsert: true });

    const { po } = await receivePO({ qty: 10, unitCost: 112, claimInputVat: true });
    expect(await movement('170300')).toBe(-120);        // claimed on the way in

    const res = await auth('post', `/api/purchase-orders/${po._id}/return`)
      .send({ lines: [{ index: 0, qty: 10 }], reason: 'Off spec' });
    expect(res.body.debitMemo.vatAmount).toBeCloseTo(120, 2);
    expect(await movement('170300')).toBe(0);           // and handed straight back
    expect(await movement('130000')).toBe(0);
  });

  it('turns the credit into money the supplier holds once the invoice is paid', async () => {
    const { po, bill } = await receivePO({ qty: 10, unitCost: 100 });
    await auth('post', `/api/bills/${bill._id}/approve`).send({});
    const paid = await auth('post', `/api/bills/${bill._id}/pay`).send({ payFromAccount: '111000' });
    expect(paid.body.success).toBe(true);

    const res = await auth('post', `/api/purchase-orders/${po._id}/return`)
      .send({ lines: [{ index: 0, qty: 2 }], reason: 'Damaged, found later' });
    expect(res.body.debitMemo.appliedToBills).toBeCloseTo(0, 2);
    expect(res.body.debitMemo.creditToSupplier).toBeCloseTo(200, 2);

    const sup = await M('Supplier').findById(supplier._id).lean();
    expect(sup.creditBalance).toBeCloseTo(200, 2);
    expect(await movement('160100', res.body.debitMemo.returnNumber)).toBe(-200);
  });

  it('refuses to return more than was received, or to return it twice', async () => {
    const { po } = await receivePO({ qty: 5, unitCost: 100 });
    const tooMuch = await auth('post', `/api/purchase-orders/${po._id}/return`)
      .send({ lines: [{ index: 0, qty: 6 }], reason: 'Overreach' });
    expect(tooMuch.status).toBe(400);

    await auth('post', `/api/purchase-orders/${po._id}/return`).send({ lines: [{ index: 0, qty: 5 }], reason: 'All of it' });
    const again = await auth('post', `/api/purchase-orders/${po._id}/return`)
      .send({ lines: [{ index: 0, qty: 1 }], reason: 'Once more' });
    expect(again.status).toBe(400);
  });

  it('refuses to return goods that are no longer on hand', async () => {
    const { po } = await receivePO({ qty: 5, unitCost: 100 });
    await M('Inventory').updateOne({ _id: item._id }, { $set: { stockQty: 1 } });   // the rest was consumed
    const res = await auth('post', `/api/purchase-orders/${po._id}/return`)
      .send({ lines: [{ index: 0, qty: 5 }], reason: 'Too late' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/on hand/i);
  });

  it('will not record a return without a reason', async () => {
    const { po } = await receivePO({ qty: 5, unitCost: 100 });
    const res = await auth('post', `/api/purchase-orders/${po._id}/return`).send({ lines: [{ index: 0, qty: 1 }] });
    expect(res.status).toBe(400);
  });
});
