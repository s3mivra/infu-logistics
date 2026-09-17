// A purchase order paid for BEFORE the goods arrive.
//
// Prepaying is not a payable: nothing is owed, the supplier owes US a delivery.
// So the money books to Advances to Suppliers (170200) and receiving liquidates
// that advance rather than crediting A/P. Everything downstream of the receipt
// has to follow the same rule, or the business ends up recording a debt it
// already settled - and paying it twice.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok, supplier, item;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const M = (n) => mongoose.model(n);
const r2 = (n) => Math.round(n * 100) / 100;

// Net movement on an account: credits less debits.
const movement = async (code) => {
  const entries = await M('JournalEntry').find({ 'lines.accountCode': code }).lean();
  return r2(entries.reduce((sum, je) => sum + je.lines
    .filter(l => l.accountCode === code)
    .reduce((t, l) => t + (l.credit || 0) - (l.debit || 0), 0), 0));
};

const prepaidPO = async ({ qty = 10, unitCost = 100 } = {}) => {
  const created = await auth('post', '/api/purchase-orders').send({
    supplier: supplier.name, supplierId: String(supplier._id), status: 'Ordered',
    prepaid: true, prepaidAmount: qty * unitCost, prepaidFromAccount: '111000',
    lines: [{ invId: String(item._id), itemName: item.itemName, unit: 'pcs', packSize: 1, orderedQty: qty, unitCost }],
  });
  const po = created.body.purchaseOrder;
  const res = await auth('post', `/api/purchase-orders/${po._id}/receive`)
    .send({ received: [{ index: 0, receivedQty: qty }] });
  return { po: res.body.purchaseOrder, bill: res.body.bill };
};

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'PrepaidSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'PrepaidSuper');
}, 120000);

afterAll(async () => { await ctx.stop(); });

beforeEach(async () => {
  await Promise.all([
    M('PurchaseOrder').deleteMany({}), M('Bill').deleteMany({}), M('Advance').deleteMany({}),
    M('JournalEntry').deleteMany({}), M('StockCard').deleteMany({}),
    M('Supplier').deleteMany({}), M('Inventory').deleteMany({}),
  ]);
  supplier = await M('Supplier').create({ name: 'Acme Supply' });
  item = await M('Inventory').create({ itemName: 'Boxes', unit: 'pcs', displayUnit: 'pcs', unitMultiplier: 1, stockQty: 0, unitCost: 0 });
});

describe('receiving a prepaid PO', () => {
  it('clears the advance instead of raising a payable', async () => {
    await prepaidPO({ qty: 10, unitCost: 100 });
    expect(await movement('170200')).toBe(0);   // the advance is used up
    expect(await movement('220000')).toBe(0);   // and no debt was ever created
  });

  it('raises no bill to pay - that money already left', async () => {
    const { bill } = await prepaidPO({ qty: 10, unitCost: 100 });
    // A bill here is a second demand for money already handed over: approve and
    // pay it and the supplier is paid twice, with A/P driven negative.
    expect(bill).toBeFalsy();
    expect(await M('Bill').countDocuments({})).toBe(0);
  });
});

describe('returning goods from a prepaid PO', () => {
  it('puts the money back on the advance, not onto a payable', async () => {
    const { po } = await prepaidPO({ qty: 10, unitCost: 100 });

    const res = await auth('post', `/api/purchase-orders/${po._id}/return`)
      .send({ lines: [{ index: 0, qty: 4 }], reason: 'Damaged in transit' });
    expect(res.status).toBe(200);

    // The supplier is holding ₱400 of our money against a delivery we sent
    // back - that is an advance still outstanding, not a debt they owe on
    // account, and certainly not a reduction of a payable that never existed.
    expect(await movement('220000')).toBe(0);
    expect(await movement('170200')).toBe(-400);

    const adv = await M('Advance').findOne({}).lean();
    expect(r2(adv.amount - adv.liquidatedAmount)).toBe(400);
    expect(adv.status).not.toBe('Liquidated');
  });

  it('leaves the stock and the books agreeing after the return', async () => {
    const { po } = await prepaidPO({ qty: 10, unitCost: 100 });
    const res = await auth('post', `/api/purchase-orders/${po._id}/return`)
      .send({ lines: [{ index: 0, qty: 10 }], reason: 'Wrong goods entirely' });

    const je = await M('JournalEntry').findOne({ reference: res.body.debitMemo.returnNumber }).lean();
    expect(je.totalDebit).toBeCloseTo(je.totalCredit, 2);
    expect(await movement('130000')).toBe(0);           // no stock left carried
    expect((await M('Inventory').findById(item._id).lean()).stockQty).toBe(0);
  });
});

// A PO line that is not stock: a machine, or a service.
//
// These credit a NON-TRADE payable (225100 for equipment, 225200 for a
// service) rather than 220000 - owing for a machine is a different obligation
// from owing for goods to sell. Claiming input VAT on one used to debit the
// asset at cost, credit the payable at that same net figure, and post no input
// VAT line at all: the supplier was under-recorded by exactly the VAT, and the
// credit the business thought it had taken existed nowhere.
describe('receiving equipment and services on a PO', () => {
  const vatOn = async (on) => {
    await M('Settings').updateOne({ key: 'vatEnabled' }, { $set: { value: on } }, { upsert: true });
    await M('Settings').updateOne({ key: 'vatRate' }, { $set: { value: 12 } }, { upsert: true });
  };

  const receiveLines = async (lines, { claimInputVat = false, prepaid = false } = {}) => {
    const created = await auth('post', '/api/purchase-orders').send({
      supplier: supplier.name, supplierId: String(supplier._id), status: 'Ordered',
      ...(prepaid ? { prepaid: true, prepaidAmount: 1120, prepaidFromAccount: '111000' } : {}),
      lines,
    });
    const po = created.body.purchaseOrder;
    const res = await auth('post', `/api/purchase-orders/${po._id}/receive`)
      .send({ received: lines.map((_, i) => ({ index: i, receivedQty: 1 })), claimInputVat });
    return res.body;
  };

  it('books the asset net of VAT and owes the supplier the full invoice', async () => {
    await vatOn(true);
    await receiveLines([{
      purchaseType: 'fixedAsset', assetAccountCode: '140200', itemName: 'Dough mixer',
      unit: 'unit', orderedQty: 1, unitCost: 1120, usefulLifeMonths: 60,
    }], { claimInputVat: true });

    expect(await movement('140200')).toBe(-1000);   // the asset, at its real cost
    expect(await movement('170300')).toBe(-120);    // the VAT, claimable
    expect(await movement('225100')).toBe(1120);    // and the supplier is owed the lot
    await vatOn(false);
  });

  it('bills the supplier the gross, not the net', async () => {
    await vatOn(true);
    const out = await receiveLines([{
      purchaseType: 'expense', expenseAccountCode: '630000', itemName: 'Annual service',
      unit: 'job', orderedQty: 1, unitCost: 1120,
    }], { claimInputVat: true });

    // Billing the net would leave ₱120 of the supplier's invoice unpayable
    // through the system - and the ledger and the bill disagreeing.
    expect(out.bill?.amount).toBeCloseTo(1120, 2);
    await vatOn(false);
  });

  it('keeps the entry balanced whichever way it is paid for', async () => {
    await receiveLines([{
      purchaseType: 'fixedAsset', assetAccountCode: '140300', itemName: 'Laptop',
      unit: 'unit', orderedQty: 1, unitCost: 1120, usefulLifeMonths: 36,
    }], { prepaid: true });

    const entries = await M('JournalEntry').find({}).lean();
    for (const je of entries) expect(je.totalDebit).toBeCloseTo(je.totalCredit, 2);
    expect(await movement('170200')).toBe(0);       // the advance is used up
    expect(await movement('225100')).toBe(0);       // nothing owed on top
  });
});

// A line the receipt could not post is worse than one rejected up front: the
// PO saves, the goods arrive, and nothing at all reaches the books.
describe('a non-stock line with nowhere to post', () => {
  const makePO = (line) => auth('post', '/api/purchase-orders').send({
    supplier: supplier.name, supplierId: String(supplier._id), status: 'Ordered', lines: [line],
  });

  it('refuses equipment with no asset account', async () => {
    const res = await makePO({ purchaseType: 'fixedAsset', itemName: 'Mixer', unit: 'unit', orderedQty: 1, unitCost: 500 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/asset account/i);
  });

  it('refuses a service charged to an account that is not an expense', async () => {
    const res = await makePO({ purchaseType: 'expense', expenseAccountCode: '111000', itemName: 'Repair', unit: 'job', orderedQty: 1, unitCost: 500 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/expense account/i);
  });

  it('accepts one that is properly routed, and keeps the kind on the line', async () => {
    const res = await makePO({
      purchaseType: 'fixedAsset', assetAccountCode: '140200', itemName: 'Mixer',
      unit: 'unit', orderedQty: 1, unitCost: 500, usefulLifeMonths: 60,
    });
    expect(res.body.success).toBe(true);
    const line = res.body.purchaseOrder.lines[0];
    expect(line.purchaseType).toBe('fixedAsset');
    expect(line.assetAccountCode).toBe('140200');
    expect(line.usefulLifeMonths).toBe(60);
  });
});

// A new PO is filed as a requisition slip first and only becomes a PO when
// someone approves it. The line kind has to survive that round trip, or
// equipment requisitioned as equipment arrives as stock.
describe('requisition to purchase order', () => {
  it('carries the line kind and its account through approval', async () => {
    const slip = await auth('post', '/api/requisition-slips').send({
      type: 'procurement', supplier: supplier.name, supplierId: String(supplier._id),
      lines: [{
        purchaseType: 'fixedAsset', assetAccountCode: '140200', usefulLifeMonths: 60,
        itemName: 'Dough mixer', unit: 'unit', orderedQty: 1, unitCost: 25000,
      }],
    });
    expect(slip.body.success).toBe(true);
    expect(slip.body.slip.lines[0].purchaseType).toBe('fixedAsset');

    const approved = await auth('post', `/api/requisition-slips/${slip.body.slip._id}/approve`).send({});
    expect(approved.body.success).toBe(true);

    const po = await M('PurchaseOrder').findOne({ poNumber: approved.body.slip?.resultRefLabel || /PO-/ }).lean();
    expect(po.lines[0].purchaseType).toBe('fixedAsset');
    expect(po.lines[0].assetAccountCode).toBe('140200');
    expect(po.lines[0].usefulLifeMonths).toBe(60);
  });

  it('keeps a stock line a stock line', async () => {
    const slip = await auth('post', '/api/requisition-slips').send({
      type: 'procurement', supplier: supplier.name, supplierId: String(supplier._id),
      lines: [{ invId: String(item._id), itemName: 'Boxes', unit: 'pcs', orderedQty: 5, unitCost: 10 }],
    });
    const approved = await auth('post', `/api/requisition-slips/${slip.body.slip._id}/approve`).send({});
    const po = await M('PurchaseOrder').findById(approved.body.slip.resultRefId).lean();
    expect(po.lines[0].purchaseType).toBe('inventory');
    expect(String(po.lines[0].invId)).toBe(String(item._id));
  });
});

// Deliveries received before `inputVatClaimed` existed did not record whether
// their VAT was taken as a creditable input. Returning goods from one would
// hand back the goods and the payable but NOT the input VAT - leaving a credit
// claimed on stock no longer held. The ledger already knows, so it is
// reconstructed from there at boot.
describe('the one-time backfill for input VAT claimed on older deliveries', () => {
  const vatOn = async (on) => {
    await M('Settings').updateOne({ key: 'vatEnabled' }, { $set: { value: on } }, { upsert: true });
    await M('Settings').updateOne({ key: 'vatRate' }, { $set: { value: 12 } }, { upsert: true });
  };

  it('sets the flag from the receipt entry, and a later return gives the VAT back', async () => {
    await vatOn(true);
    const created = await auth('post', '/api/purchase-orders').send({
      supplier: supplier.name, supplierId: String(supplier._id), status: 'Ordered',
      lines: [{ invId: String(item._id), itemName: item.itemName, unit: 'pcs', packSize: 1, orderedQty: 10, unitCost: 112 }],
    });
    const po = created.body.purchaseOrder;
    await auth('post', `/api/purchase-orders/${po._id}/receive`)
      .send({ received: [{ index: 0, receivedQty: 10 }], claimInputVat: true });
    expect(await movement('170300')).toBe(-120);

    // Rewind to how an older deployment stored it: the claim happened, but
    // nothing on the order says so.
    await M('PurchaseOrder').updateOne({ _id: po._id }, { $set: { inputVatClaimed: false } });

    await ctx.runStartupTasks();
    expect((await M('PurchaseOrder').findById(po._id).lean()).inputVatClaimed).toBe(true);

    // And because the flag is right, the return hands the VAT back.
    const res = await auth('post', `/api/purchase-orders/${po._id}/return`)
      .send({ lines: [{ index: 0, qty: 10 }], reason: 'All of it went back' });
    expect(res.body.debitMemo.vatAmount).toBeCloseTo(120, 2);
    expect(await movement('170300')).toBe(0);
    await vatOn(false);
  });

  it('leaves a delivery that never claimed input VAT alone', async () => {
    const created = await auth('post', '/api/purchase-orders').send({
      supplier: supplier.name, supplierId: String(supplier._id), status: 'Ordered',
      lines: [{ invId: String(item._id), itemName: item.itemName, unit: 'pcs', packSize: 1, orderedQty: 5, unitCost: 100 }],
    });
    const po = created.body.purchaseOrder;
    await auth('post', `/api/purchase-orders/${po._id}/receive`).send({ received: [{ index: 0, receivedQty: 5 }] });

    await ctx.runStartupTasks();
    expect((await M('PurchaseOrder').findById(po._id).lean()).inputVatClaimed).toBe(false);
  });
});
