// requisitions.view/requisitions.approve (#11) are dedicated permissions,
// decoupled from accounting.view/accounting.manage - granting one must not
// silently unlock the other.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let app, stop, superToken;
const auth = (t) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'log', jwtSecret: 'req-perm-test-secret-0123456789' }));
  await makeUser({ name: 'ReqPermBoss', role: 'superadmin', password: 'pw' });
  await mongoose.model('User').updateMany({}, { $set: { tenantId: null } });
  superToken = await loginStaff(app, 'ReqPermBoss', 'pw');
}, 120000);

afterAll(async () => { await stop(); });

describe('requisitions permission is decoupled from accounting.*', () => {
  it('a staff user with accounting.view but NOT requisitions.view sees only their OWN slips, not the full queue', async () => {
    await makeUser({ name: 'LedgerOnlyStaff', role: 'staff', password: 'pw', permissions: ['accounting.view'] });
    const staffToken = await loginStaff(app, 'LedgerOnlyStaff', 'pw');

    // File a slip as this same self-service-only staff member.
    const RevolvingFund = mongoose.model('RevolvingFund');
    const fund = await RevolvingFund.create({ businessType: 'log', name: 'Self-Service Fund', initialAmount: 500, currentBalance: 500 });
    const filed = await request(app).post('/api/requisition-slips').set(auth(staffToken))
      .send({ type: 'petty-cash', fundId: fund._id, amount: 100, description: 'test' });
    expect(filed.body.success).toBe(true);

    // Someone else's slip, filed by superadmin, must NOT show up for this user.
    const other = await request(app).post('/api/requisition-slips').set(auth(superToken))
      .send({ type: 'petty-cash', fundId: fund._id, amount: 50, description: 'not mine' });
    expect(other.body.success).toBe(true);

    const res = await request(app).get('/api/requisition-slips').set(auth(staffToken));
    expect(res.status).toBe(200);
    expect(res.body.slips.every(s => s.preparedBy === 'LedgerOnlyStaff')).toBe(true);
    expect(res.body.slips.some(s => s._id === filed.body.slip._id)).toBe(true);
    expect(res.body.slips.some(s => s._id === other.body.slip._id)).toBe(false);

    // Can open their own slip's detail...
    const own = await request(app).get(`/api/requisition-slips/${filed.body.slip._id}`).set(auth(staffToken));
    expect(own.status).toBe(200);
    // ...but not someone else's, even by direct ID.
    const notOwn = await request(app).get(`/api/requisition-slips/${other.body.slip._id}`).set(auth(staffToken));
    expect(notOwn.status).toBe(404);
  });

  it('a staff user with requisitions.view but NOT accounting.view CAN see the Approvals queue', async () => {
    await makeUser({ name: 'ReqOnlyStaff', role: 'staff', password: 'pw', permissions: ['requisitions.view'] });
    const token = await loginStaff(app, 'ReqOnlyStaff', 'pw');
    const res = await request(app).get('/api/requisition-slips').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('requisitions.view alone does not grant approve/reject - needs requisitions.approve', async () => {
    await makeUser({ name: 'ReqViewOnly', role: 'staff', password: 'pw', permissions: ['requisitions.view'] });
    const token = await loginStaff(app, 'ReqViewOnly', 'pw');
    const res = await request(app).post('/api/requisition-slips/000000000000000000000000/approve').set(auth(token));
    expect(res.status).toBe(403);
  });

  it('the seeded job-title roles exist and resolve sensible permissions', async () => {
    const Role = mongoose.model('Role');
    const names = (await Role.find().lean()).map(r => r.name);
    for (const n of ['Logistics', 'Office', 'Admin', 'Barista', 'Head Barista']) {
      expect(names).toContain(n);
    }
    const barista = await Role.findOne({ name: 'Barista' }).lean();
    expect(barista.permissions).toContain('pos.use');
    expect(barista.permissions).not.toContain('accounting.manage');

    const office = await Role.findOne({ name: 'Office' }).lean();
    expect(office.permissions).toContain('requisitions.view');
    expect(office.permissions).not.toContain('requisitions.approve');
  });
});
