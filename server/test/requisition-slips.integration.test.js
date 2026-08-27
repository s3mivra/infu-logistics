// Requisition slips gate two kinds of movement that used to happen
// immediately: a petty-cash disbursement and a new purchase order. Filing a
// slip must NOT move anything; approving it must actually move it (and only
// once); rejecting it must move nothing and be final.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let app, stop, superToken;

const auth = (t) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'log', jwtSecret: 'req-test-secret-0123456789' }));
  await makeUser({ name: 'ReqBoss', role: 'superadmin', password: 'pw' });
  await mongoose.model('User').updateMany({}, { $set: { tenantId: null } });
  superToken = await loginStaff(app, 'ReqBoss', 'pw');
}, 120000);

afterAll(async () => { await stop(); });

describe('petty-cash requisition slips', () => {
  it('filing a slip does not touch the fund balance; approving it does, exactly once', async () => {
    const fundRes = await request(app).post('/api/revolving-funds').set(auth(superToken))
      .send({ name: 'Test Petty Cash', initialAmount: 1000 });
    expect(fundRes.body.success).toBe(true);
    const fund = fundRes.body.fund;

    const slipRes = await request(app).post('/api/requisition-slips').set(auth(superToken))
      .send({ type: 'petty-cash', fundId: fund._id, amount: 250, description: 'Office supplies' });
    expect(slipRes.body.success).toBe(true);
    const slip = slipRes.body.slip;
    expect(slip.status).toBe('Pending');
    expect(slip.preparedBy).toBe('ReqBoss');

    const untouchedFund = await request(app).get('/api/revolving-funds').set(auth(superToken));
    const f = untouchedFund.body.funds.find(x => x._id === fund._id);
    expect(f.currentBalance).toBe(1000); // unchanged - filing alone must not move money

    const approveRes = await request(app).post(`/api/requisition-slips/${slip._id}/approve`).set(auth(superToken)).send({});
    expect(approveRes.body.success).toBe(true);
    expect(approveRes.body.fund.currentBalance).toBe(750);
    expect(approveRes.body.slip.status).toBe('Approved');
    expect(approveRes.body.slip.approvedBy).toBe('ReqBoss');
    expect(approveRes.body.slip.resultRefLabel).toMatch(/^RF-OUT/);

    // Re-approving a non-Pending slip must be refused, not double-post.
    const secondApprove = await request(app).post(`/api/requisition-slips/${slip._id}/approve`).set(auth(superToken)).send({});
    expect(secondApprove.status).toBe(409);
    const stillFund = await request(app).get('/api/revolving-funds').set(auth(superToken));
    expect(stillFund.body.funds.find(x => x._id === fund._id).currentBalance).toBe(750); // still 750, not 500
  });

  it('rejecting a slip requires a reason and moves nothing', async () => {
    const fundRes = await request(app).post('/api/revolving-funds').set(auth(superToken))
      .send({ name: 'Reject Test Fund', initialAmount: 500 });
    const fund = fundRes.body.fund;
    const slipRes = await request(app).post('/api/requisition-slips').set(auth(superToken))
      .send({ type: 'petty-cash', fundId: fund._id, amount: 100, description: 'Snacks' });
    const slip = slipRes.body.slip;

    const noReason = await request(app).post(`/api/requisition-slips/${slip._id}/reject`).set(auth(superToken)).send({});
    expect(noReason.status).toBe(400);

    const rejectRes = await request(app).post(`/api/requisition-slips/${slip._id}/reject`).set(auth(superToken)).send({ reason: 'Not a valid expense' });
    expect(rejectRes.body.success).toBe(true);
    expect(rejectRes.body.slip.status).toBe('Rejected');
    expect(rejectRes.body.slip.rejectedBy).toBe('ReqBoss');

    const stillFund = await request(app).get('/api/revolving-funds').set(auth(superToken));
    expect(stillFund.body.funds.find(x => x._id === fund._id).currentBalance).toBe(500); // untouched
  });
});

describe('procurement requisition slips', () => {
  it('filing a slip does not create a PO; approving it does', async () => {
    const slipRes = await request(app).post('/api/requisition-slips').set(auth(superToken))
      .send({
        type: 'procurement', supplier: 'Test Supplier',
        lines: [{ itemName: 'Widget', orderedQty: 10, unitCost: 50 }],
      });
    expect(slipRes.body.success).toBe(true);
    const slip = slipRes.body.slip;
    expect(slip.status).toBe('Pending');
    expect(slip.estTotal).toBe(500);

    const poListBefore = await request(app).get('/api/purchase-orders').set(auth(superToken));
    const beforeCount = poListBefore.body.orders?.length ?? poListBefore.body.purchaseOrders?.length ?? 0;

    const approveRes = await request(app).post(`/api/requisition-slips/${slip._id}/approve`).set(auth(superToken)).send({});
    expect(approveRes.body.success).toBe(true);
    expect(approveRes.body.purchaseOrder.status).toBe('Ordered');
    expect(approveRes.body.purchaseOrder.estTotal).toBe(500);
    expect(approveRes.body.slip.resultRefLabel).toBe(approveRes.body.purchaseOrder.poNumber);

    const poListAfter = await request(app).get('/api/purchase-orders').set(auth(superToken));
    const afterCount = poListAfter.body.orders?.length ?? poListAfter.body.purchaseOrders?.length ?? 0;
    expect(afterCount).toBe(beforeCount + 1);
  });

  it('rejects a slip with no line items', async () => {
    const res = await request(app).post('/api/requisition-slips').set(auth(superToken))
      .send({ type: 'procurement', supplier: 'X', lines: [] });
    expect(res.status).toBe(400);
  });
});
