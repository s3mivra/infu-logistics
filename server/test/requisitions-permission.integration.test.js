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
  it('a staff user with accounting.view but NOT requisitions.view cannot see the Approvals queue', async () => {
    await makeUser({ name: 'LedgerOnlyStaff', role: 'staff', password: 'pw', permissions: ['accounting.view'] });
    const token = await loginStaff(app, 'LedgerOnlyStaff', 'pw');
    const res = await request(app).get('/api/requisition-slips').set(auth(token));
    expect(res.status).toBe(403);
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
