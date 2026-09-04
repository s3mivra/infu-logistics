// Date-range filters must use ONE timezone basis for both bounds.
//
// `new Date('2026-09-03')` is parsed by JS as UTC midnight, but `.setHours()`
// works in local time. Mixing them produces a window of local 08:00-23:59 in
// UTC+8, so every record made between midnight and 8am falls outside "today"
// and never appears in any day's report. lib/reportRange.js documents this
// exact bug being fixed once already; these tests stop it coming back through
// the newer endpoints.
//
// A record stamped 00:30 local is the case that fails under the broken parse
// and passes under the correct one.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;
const auth = (p) => request(app).get(p).set('Authorization', `Bearer ${tok}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'DateSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'DateSuper');
}, 120000);

afterAll(async () => { await ctx.stop(); });

const M = (n) => mongoose.model(n);

// Local wall-clock times on a fixed day, which is how a shop thinks about its
// own trading day.
const DAY = '2026-09-03';
const localAt = (h, m = 0) => new Date(2026, 8, 3, h, m, 0, 0);

beforeEach(async () => {
  for (const n of ['StockCard', 'CheckVoucher', 'Advance']) await M(n).deleteMany({});
});

describe('stock card history covers the whole local day', () => {
  beforeEach(async () => {
    await M('StockCard').insertMany([
      { inventoryId: 'i1', itemName: 'Beans', date: localAt(0, 30), type: 'Sale', qtyChange: -1, balanceAfter: 9 },
      { inventoryId: 'i1', itemName: 'Beans', date: localAt(12), type: 'Sale', qtyChange: -1, balanceAfter: 8 },
      { inventoryId: 'i1', itemName: 'Beans', date: localAt(23, 45), type: 'Sale', qtyChange: -1, balanceAfter: 7 },
    ]);
  });

  it('includes an entry made just after local midnight', async () => {
    const res = await auth(`/api/inventory/history?start=${DAY}&end=${DAY}`);
    expect(res.status).toBe(200);
    // Under the mixed-basis bug the 00:30 row is silently excluded.
    expect(res.body.history).toHaveLength(3);
  });

  it('includes an entry made late in the evening', async () => {
    const res = await auth(`/api/inventory/history?start=${DAY}&end=${DAY}`);
    const hours = res.body.history.map(h => new Date(h.date).getHours());
    expect(hours).toContain(23);
    expect(hours).toContain(0);
  });

  it('excludes the neighbouring days', async () => {
    await M('StockCard').insertMany([
      { inventoryId: 'i1', itemName: 'Beans', date: new Date(2026, 8, 2, 23, 59), type: 'Sale', qtyChange: -1, balanceAfter: 6 },
      { inventoryId: 'i1', itemName: 'Beans', date: new Date(2026, 8, 4, 0, 1), type: 'Sale', qtyChange: -1, balanceAfter: 5 },
    ]);
    const res = await auth(`/api/inventory/history?start=${DAY}&end=${DAY}`);
    expect(res.body.history).toHaveLength(3);
  });
});

describe('check voucher list covers the whole local day', () => {
  it('includes a voucher issued just after local midnight', async () => {
    await M('CheckVoucher').insertMany([
      { voucherNumber: 'CV-1', payeeType: 'supplier', payeeName: 'A', amount: 100, purpose: 'bill-payment', date: localAt(0, 15) },
      { voucherNumber: 'CV-2', payeeType: 'supplier', payeeName: 'B', amount: 200, purpose: 'bill-payment', date: localAt(15) },
    ]);
    const res = await auth(`/api/check-vouchers?start=${DAY}&end=${DAY}`);
    expect(res.status).toBe(200);
    expect(res.body.vouchers).toHaveLength(2);
    expect(res.body.total).toBeCloseTo(300, 2);
  });
});

describe('advances list covers the whole local day', () => {
  it('includes an advance issued just after local midnight', async () => {
    await M('Advance').insertMany([
      { advanceNumber: 'ADV-1', type: 'employee', payeeName: 'Rider', amount: 500, date: localAt(0, 5) },
      { advanceNumber: 'ADV-2', type: 'employee', payeeName: 'Rider', amount: 700, date: localAt(18) },
    ]);
    const res = await auth(`/api/advances?start=${DAY}&end=${DAY}`);
    expect(res.status).toBe(200);
    expect(res.body.advances).toHaveLength(2);
    expect(res.body.totalIssued).toBeCloseTo(1200, 2);
  });

  it('still excludes a day either side', async () => {
    await M('Advance').insertMany([
      { advanceNumber: 'ADV-3', type: 'employee', payeeName: 'R', amount: 100, date: new Date(2026, 8, 2, 22) },
      { advanceNumber: 'ADV-4', type: 'employee', payeeName: 'R', amount: 100, date: localAt(9) },
      { advanceNumber: 'ADV-5', type: 'employee', payeeName: 'R', amount: 100, date: new Date(2026, 8, 4, 1) },
    ]);
    const res = await auth(`/api/advances?start=${DAY}&end=${DAY}`);
    expect(res.body.advances).toHaveLength(1);
    expect(res.body.advances[0].advanceNumber).toBe('ADV-4');
  });
});
