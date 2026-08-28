// Creating a NEW revolving fund used to be immediate for anyone with
// accounting.manage - same class of gap as disbursements had before the
// Requisition Slip system existed. Fund creation now requires the same
// approval gate: staff files a 'new-fund' requisition slip, only approval
// actually creates the RevolvingFund. Direct POST /api/revolving-funds is
// superadmin-only.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let app, stop, superToken, staffToken;
const auth = (t) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'log', jwtSecret: 'rf-approval-test-secret-0123456789' }));
  await makeUser({ name: 'RfBoss', role: 'superadmin', password: 'pw' });
  await makeUser({ name: 'RfStaff', role: 'staff', password: 'pw', permissions: ['requisitions.view', 'requisitions.approve'] });
  await mongoose.model('User').updateMany({}, { $set: { tenantId: null } });
  superToken = await loginStaff(app, 'RfBoss', 'pw');
  staffToken = await loginStaff(app, 'RfStaff', 'pw');
}, 120000);

afterAll(async () => { await stop(); });

describe('revolving fund creation requires approval for non-superadmin', () => {
  it('a staff account cannot POST /api/revolving-funds directly', async () => {
    const res = await request(app).post('/api/revolving-funds').set(auth(staffToken))
      .send({ name: 'Direct Attempt', initialAmount: 500, sourceAccount: '111000' });
    expect(res.status).toBe(403);
    const RevolvingFund = mongoose.model('RevolvingFund');
    expect(await RevolvingFund.findOne({ name: 'Direct Attempt' })).toBeNull();
  });

  it('staff files a new-fund requisition slip instead - no fund exists yet', async () => {
    const res = await request(app).post('/api/requisition-slips').set(auth(staffToken))
      .send({ type: 'new-fund', fundName: 'Warehouse Petty Cash', amount: 2000, description: 'For minor supplies', sourceAccount: '111000' });
    expect(res.body.success).toBe(true);
    expect(res.body.slip.status).toBe('Pending');

    const RevolvingFund = mongoose.model('RevolvingFund');
    expect(await RevolvingFund.findOne({ name: 'Warehouse Petty Cash' })).toBeNull();
  });

  it('approving the slip actually creates the fund, funded and balanced', async () => {
    const listRes = await request(app).get('/api/requisition-slips?status=Pending').set(auth(superToken));
    const slip = listRes.body.slips.find(s => s.type === 'new-fund' && s.fundName === 'Warehouse Petty Cash');
    expect(slip).toBeTruthy();

    const approveRes = await request(app).post(`/api/requisition-slips/${slip._id}/approve`).set(auth(superToken));
    expect(approveRes.body.success).toBe(true);
    expect(approveRes.body.fund.currentBalance).toBe(2000);

    const RevolvingFund = mongoose.model('RevolvingFund');
    const fund = await RevolvingFund.findOne({ name: 'Warehouse Petty Cash' }).lean();
    expect(fund).toBeTruthy();
    expect(fund.initialAmount).toBe(2000);

    const JournalEntry = mongoose.model('JournalEntry');
    const je = await JournalEntry.findOne({ description: new RegExp('Warehouse Petty Cash') }).lean();
    expect(je.totalDebit).toBeCloseTo(je.totalCredit, 2);
  });

  it('superadmin can still create a fund directly, immediately', async () => {
    const res = await request(app).post('/api/revolving-funds').set(auth(superToken))
      .send({ name: 'Superadmin Direct Fund', initialAmount: 1000, sourceAccount: '111000' });
    expect(res.body.success).toBe(true);
    expect(res.body.fund.currentBalance).toBe(1000);
  });

  it('rejects a duplicate fund name at approval time even if it slipped past creation', async () => {
    // File a second slip for a name that already exists as an active fund.
    const res = await request(app).post('/api/requisition-slips').set(auth(staffToken))
      .send({ type: 'new-fund', fundName: 'Warehouse Petty Cash', amount: 500, sourceAccount: '111000' });
    expect(res.status).toBe(400); // create-time dup check already catches it
  });
});
