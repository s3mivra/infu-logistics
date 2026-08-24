// GET /api/requisitions permission sweep - Phase 7. Listing requisitions used
// to be plain requireStaff (any logged-in staff), which let a cashier read
// every pending revolving-fund disbursement's amount and description company-
// wide. Now it's gated per type: purchase_order needs procurement.view (same
// as the Procurement tab), fund_disbursement and the unfiltered "both types"
// query (what the Approvals inbox uses) need accounting.manage (same as the
// Approvals tab's nav gate and the approve/reject routes).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let app, stop, superToken, cashierToken, financeToken;

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'log', jwtSecret: 'req-list-test-secret-0123456789' }));
  await makeUser({ name: 'ReqBoss', role: 'superadmin', password: 'pw' });
  await makeUser({ name: 'ReqCashier', role: 'cashier', password: 'pw' });   // procurement.view only, no accounting.*
  await makeUser({ name: 'ReqFinance', role: 'finance', password: 'pw' });  // procurement.view + accounting.manage
  await mongoose.model('User').updateMany({}, { $set: { tenantId: null } });
  superToken = await loginStaff(app, 'ReqBoss', 'pw');
  cashierToken = await loginStaff(app, 'ReqCashier', 'pw');
  financeToken = await loginStaff(app, 'ReqFinance', 'pw');
}, 120000);

afterAll(async () => { await stop(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });

describe('GET /api/requisitions permission gate', () => {
  it('cashier (procurement.view, no accounting) CAN list type=purchase_order', async () => {
    const res = await request(app).get('/api/requisitions?type=purchase_order').set(auth(cashierToken));
    expect(res.status).toBe(200);
  });

  it('cashier CANNOT list type=fund_disbursement', async () => {
    const res = await request(app).get('/api/requisitions?type=fund_disbursement').set(auth(cashierToken));
    expect(res.status).toBe(403);
  });

  it('cashier CANNOT list unfiltered (would include fund data)', async () => {
    const res = await request(app).get('/api/requisitions').set(auth(cashierToken));
    expect(res.status).toBe(403);
  });

  it('finance (procurement.view + accounting.manage) can list both types and unfiltered', async () => {
    const po = await request(app).get('/api/requisitions?type=purchase_order').set(auth(financeToken));
    const fund = await request(app).get('/api/requisitions?type=fund_disbursement').set(auth(financeToken));
    const all = await request(app).get('/api/requisitions').set(auth(financeToken));
    expect(po.status).toBe(200);
    expect(fund.status).toBe(200);
    expect(all.status).toBe(200);
  });

  it('superadmin bypasses every gate', async () => {
    const res = await request(app).get('/api/requisitions').set(auth(superToken));
    expect(res.status).toBe(200);
  });

  it('rejects an unrecognized type value', async () => {
    const res = await request(app).get('/api/requisitions?type=not-a-real-type').set(auth(superToken));
    expect(res.status).toBe(400);
  });
});
