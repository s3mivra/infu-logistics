// Supplier-attributed A/P: receiving on credit builds a per-supplier balance,
// paying that supplier draws it down, and both show in the A/P journal history.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let app, stop, superToken, supplierAId, supplierBId, invId;

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const ap = async () => (await request(app).get('/api/finance/ap-outstanding').set(auth(superToken))).body;
const rowFor = (body, name) => body.bySupplier.find(s => s.supplier === name);

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'log', jwtSecret: 'ap-test-secret-0123456789' }));
  await makeUser({ name: 'ApBoss', role: 'superadmin', password: 'pw' });
  await mongoose.model('User').updateMany({}, { $set: { tenantId: null } });
  superToken = await loginStaff(app, 'ApBoss', 'pw');

  const a = await request(app).post('/api/suppliers').set(auth(superToken)).send({ name: 'best beans co' });
  supplierAId = a.body.supplier._id;
  const b = await request(app).post('/api/suppliers').set(auth(superToken)).send({ name: 'milk masters' });
  supplierBId = b.body.supplier._id;

  const inv = await mongoose.model('Inventory').create({
    itemCode: 'AP-MILK', itemName: 'Ap Milk', stockQty: 0, unit: 'ml',
    unitCost: 0, displayUnit: 'L', unitMultiplier: 1000, packSize: 1, businessType: 'log',
  });
  invId = String(inv._id);
}, 120000);

afterAll(async () => { await stop(); });

// Receive goods on credit from a supplier - the standard way A/P is incurred.
const receiveFrom = async (supplierId, supplierName, qty, unitCost) => {
  const created = await request(app).post('/api/purchase-orders').set(auth(superToken)).send({
    supplier: supplierName, supplierId,
    lines: [{ invId, itemName: 'Ap Milk', unit: 'L', packSize: 1, orderedQty: qty, unitCost }],
  });
  const po = created.body.purchaseOrder;
  await request(app).post(`/api/purchase-orders/${po._id}/receive`).set(auth(superToken))
    .send({ received: [{ lineId: po.lines[0]._id, receivedQty: qty }] });
  return po;
};

describe('receiving on credit builds a per-supplier payable', () => {
  it('attributes the payable to the supplier that shipped it', async () => {
    await receiveFrom(supplierAId, 'Best Beans Co', 10, 80);   // ₱800
    const body = await ap();
    const row = rowFor(body, 'Best Beans Co');
    expect(row).toBeTruthy();
    expect(row.incurred).toBeCloseTo(800, 2);
    expect(row.paid).toBe(0);
    expect(row.balance).toBeCloseTo(800, 2);
  });

  it('keeps two suppliers on separate balances', async () => {
    await receiveFrom(supplierBId, 'Milk Masters', 5, 100);    // ₱500
    const body = await ap();
    expect(rowFor(body, 'Best Beans Co').balance).toBeCloseTo(800, 2);
    expect(rowFor(body, 'Milk Masters').balance).toBeCloseTo(500, 2);
    expect(body.outstandingBalance).toBeCloseTo(1300, 2);
  });

  it('names the supplier in the journal history', async () => {
    const body = await ap();
    const entry = body.recent.find(r => /Best Beans Co/.test(r.supplierName || ''));
    expect(entry).toBeTruthy();
    expect(entry.credit).toBeGreaterThan(0);      // a payable was incurred
  });
});

describe('paying a supplier draws down their balance', () => {
  it('reduces only the supplier that was paid', async () => {
    const res = await request(app).post('/api/finance/ap-payment').set(auth(superToken))
      .send({ amount: 300, payFromAccount: '111000', supplierId: supplierAId });
    expect(res.status).toBe(200);

    const body = await ap();
    expect(rowFor(body, 'Best Beans Co').paid).toBeCloseTo(300, 2);
    expect(rowFor(body, 'Best Beans Co').balance).toBeCloseTo(500, 2);
    expect(rowFor(body, 'Milk Masters').balance).toBeCloseTo(500, 2);  // untouched
    expect(body.outstandingBalance).toBeCloseTo(1000, 2);
  });

  it('shows the payment in the A/P journal history against that supplier', async () => {
    const body = await ap();
    const pay = body.recent.find(r => /^AP-PAY/.test(r.reference || ''));
    expect(pay).toBeTruthy();
    expect(pay.supplierName).toBe('Best Beans Co');
    expect(pay.debit).toBeCloseTo(300, 2);        // debit = payable settled
  });

  it('uses the canonical supplier name, not whatever the client typed', async () => {
    await request(app).post('/api/finance/ap-payment').set(auth(superToken))
      .send({ amount: 1, payFromAccount: '111000', supplierId: supplierBId, vendorName: 'TYPO NAME' });
    const body = await ap();
    const pay = body.recent.find(r => r.supplierName === 'Milk Masters' && r.debit === 1);
    expect(pay).toBeTruthy();
  });

  it('rejects a payment against a supplier that does not exist', async () => {
    const res = await request(app).post('/api/finance/ap-payment').set(auth(superToken))
      .send({ amount: 50, payFromAccount: '111000', supplierId: new mongoose.Types.ObjectId().toString() });
    expect(res.status).toBe(404);
  });

  it('still allows an ad-hoc payment with no supplier record', async () => {
    const res = await request(app).post('/api/finance/ap-payment').set(auth(superToken))
      .send({ amount: 25, payFromAccount: '111000', vendorName: 'One-off Hauler' });
    expect(res.status).toBe(200);
    const body = await ap();
    expect(body.recent.some(r => r.supplierName === 'One-off Hauler')).toBe(true);
  });

  it('drops fully-settled suppliers from the payables list', async () => {
    const before = await ap();
    const owed = rowFor(before, 'Best Beans Co').balance;
    await request(app).post('/api/finance/ap-payment').set(auth(superToken))
      .send({ amount: owed, payFromAccount: '111000', supplierId: supplierAId });
    const after = await ap();
    expect(rowFor(after, 'Best Beans Co')).toBeUndefined();
  });
});

describe('legacy entries', () => {
  it('groups unattributed payables rather than hiding them', async () => {
    // Measured as a delta: the ad-hoc payment earlier in this file also has no
    // supplier, so it legitimately shares this bucket.
    const before = rowFor(await ap(), 'Unattributed')?.balance ?? 0;
    // An entry written before supplier attribution existed.
    await mongoose.model('JournalEntry').create({
      date: new Date(), reference: 'LEGACY-1', description: 'old payable',
      lines: [
        { accountCode: '130000', accountName: 'Inventory Asset', debit: 400, credit: 0 },
        { accountCode: '220000', accountName: 'Accounts Payable', debit: 0, credit: 400 },
      ],
      totalDebit: 400, totalCredit: 400,
    });
    const row = rowFor(await ap(), 'Unattributed');
    expect(row).toBeTruthy();
    expect(row.balance - before).toBeCloseTo(400, 2);
  });

  it('never labels unattributed debt with a real supplier\'s name', async () => {
    // $first on the null group would otherwise print whichever entry sorted
    // first - putting someone else's name on debt that isn't theirs.
    const body = await ap();
    const row = rowFor(body, 'Unattributed');
    expect(row.supplierId).toBe(null);
    expect(body.bySupplier.filter(s => s.supplierId === null)).toHaveLength(1);
  });
});
