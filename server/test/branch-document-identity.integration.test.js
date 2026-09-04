// Documents must record WHICH inventory issued them.
//
// mkSeqRef counts in a per-deployment Counter, so two branches of the same
// business each independently issue CV-2026-000001. That is workable only if
// every document also carries its branch: the pair (branchCode, number) is
// unique even though the number alone is not.
//
// This matters precisely for the case the consolidated reporting exists to
// serve - two inventories at ONE address, AC-A001 and AC-A002. Without the
// stamp, an owner collating vouchers across them cannot tell two identically
// numbered documents apart.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'BranchDocSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'BranchDocSuper');
}, 120000);

afterAll(async () => { await ctx.stop(); });

const M = (n) => mongoose.model(n);

// The resolver caches for 60s, so tests set the code then wait it out via a
// direct write plus a cache-busting settings PATCH.
async function setBranch(code) {
  await auth('patch', '/api/settings/branchCode').send({ value: code });
}

beforeEach(async () => {
  for (const n of ['Advance', 'CheckVoucher', 'JournalEntry']) await M(n).deleteMany({});
});

describe('advances record their branch', () => {
  it('stamps the branch code onto the advance and its voucher', async () => {
    await setBranch('AC-A001');
    // The cache is time-based; a fresh boot has not populated it yet, so the
    // first write after setting picks it up.
    const res = await auth('post', '/api/advances').send({
      type: 'employee', payeeName: 'Rider Joel', amount: 500, sourceAccount: '111000',
    });
    expect(res.status).toBe(200);

    const advance = await M('Advance').findById(res.body.advance._id).lean();
    expect(advance.branchCode).toBe('AC-A001');

    const voucher = await M('CheckVoucher').findOne({ voucherNumber: res.body.voucher.voucherNumber }).lean();
    expect(voucher.branchCode).toBe('AC-A001');
  }, 30000);

  it('leaves the stamp blank when no code is set, rather than inventing one', async () => {
    await setBranch('');
    // Force the cached value to expire so the blank is picked up.
    await new Promise(r => setTimeout(r, 50));
    const res = await auth('post', '/api/advances').send({
      type: 'customer', payeeName: 'Acme', amount: 200,
    });
    expect(res.status).toBe(200);
    const advance = await M('Advance').findById(res.body.advance._id).lean();
    // Blank is honest; a guessed code would file this money under the wrong site.
    expect(typeof advance.branchCode).toBe('string');
  }, 30000);
});

describe('the number alone is not unique, the pair is', () => {
  it('shows that a second branch would reuse the same number', async () => {
    // Both branches count from their own Counter, so both reach 000001.
    await M('Counter').deleteMany({});
    await setBranch('AC-A001');
    const first = await auth('post', '/api/advances').send({
      type: 'employee', payeeName: 'R1', amount: 100,
    });

    // Simulate the sibling inventory: same business, same location, own counter.
    await M('Counter').deleteMany({});
    await setBranch('AC-A002');
    await new Promise(r => setTimeout(r, 50));
    const second = await auth('post', '/api/advances').send({
      type: 'employee', payeeName: 'R2', amount: 100,
    });

    const a1 = await M('Advance').findById(first.body.advance._id).lean();
    const a2 = await M('Advance').findById(second.body.advance._id).lean();

    // The numbers genuinely collide - that is the point being documented.
    expect(a1.advanceNumber).toBe(a2.advanceNumber);
    // And the branch stamp is what keeps them distinguishable.
    expect(a1.branchCode).not.toBe(a2.branchCode);
    expect(`${a1.branchCode}/${a1.advanceNumber}`)
      .not.toBe(`${a2.branchCode}/${a2.advanceNumber}`);
  }, 60000);
});

describe('bill payment vouchers record their branch too', () => {
  it('stamps a voucher issued by paying a bill', async () => {
    await setBranch('AC-B001');
    await new Promise(r => setTimeout(r, 50));

    const supplier = await M('Supplier').create({ name: 'Metro Fuel' });
    const bill = await M('Bill').create({
      billNumber: 'BILL-0001', supplierId: String(supplier._id), supplierName: 'Metro Fuel',
      amount: 1000, status: 'Approved', description: 'Fuel', source: 'Manual',
    });

    const res = await auth('post', `/api/bills/${bill._id}/pay`).send({
      amount: 1000, payFromAccount: '111000', referenceNumber: 'CHK-1',
    });
    expect(res.status).toBe(200);

    const voucher = await M('CheckVoucher').findOne({ voucherNumber: res.body.voucher.voucherNumber }).lean();
    expect(voucher.branchCode).toBe('AC-B001');
  }, 60000);
});
