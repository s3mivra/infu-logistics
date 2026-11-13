// Regression tests for the 2026-11 audit's destructive-tool, backup and
// privacy findings (M18, M19, M73, M74, M96, M97).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, superTok, staffTok, staffId;
const M = (n) => mongoose.model(n);
const auth = (m, p, t) => request(app)[m](p).set('Authorization', `Bearer ${t}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log', jwtSecret: 'audit-destructive-privacy-secret-012345' });
  app = ctx.app;
  await makeUser({ name: 'DpSuper', role: 'superadmin' });
  await makeUser({ name: 'DpStaff', role: 'Staff' });
  superTok = await loginStaff(app, 'DpSuper');
  staffTok = await loginStaff(app, 'DpStaff');
  staffId = String((await M('User').findOne({ name: 'DpStaff' }).lean())._id);
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('sensitive fields at rest (M73)', () => {
  it('government ID numbers are stored sealed and read back plain', async () => {
    const r = await auth('patch', `/api/users/${staffId}`, superTok).send({ sssNumber: '34-1234567-8', tin: '123-456-789-000' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const raw = await mongoose.connection.db.collection(M('User').collection.collectionName).findOne({ _id: new mongoose.Types.ObjectId(staffId) });
    expect(raw.sssNumber).toMatch(/^v1\./);
    expect(raw.tin).toMatch(/^v1\./);
    const viaModel = await M('User').findById(staffId).lean();
    expect(viaModel.sssNumber).toBe('34-1234567-8');
  });
});

describe('SC/PWD card numbers (M73, M74)', () => {
  it('are sealed at rest and masked on the order board for till roles', async () => {
    const prod = await M('Product').create({ name: 'DpWidget', category: 'Misc', basePrice: 100 });
    const o = await auth('post', '/api/orders', superTok).send({ items: [{ productId: String(prod._id), name: 'DpWidget', price: 100, quantity: 1 }], paymentMethod: 'Cash' });
    await auth('put', `/api/orders/${o.body.order._id}`, superTok).send({ scPwdName: 'JUAN DELA CRUZ', scPwdIdNumber: 'PWD-0099-1234', scPwdKind: 'PWD' });
    const raw = await mongoose.connection.db.collection(M('Order').collection.collectionName).findOne({ _id: new mongoose.Types.ObjectId(o.body.order._id) });
    expect(raw.scPwdIdNumber).toMatch(/^v1\./);
    const staffList = await auth('get', '/api/orders', staffTok);
    expect(JSON.stringify(staffList.body)).not.toContain('PWD-0099-1234');
    expect(JSON.stringify(staffList.body)).toContain('****1234');
    const ownerList = await auth('get', '/api/orders', superTok);
    expect(JSON.stringify(ownerList.body)).toContain('PWD-0099-1234');
  });
});

describe('backups (M96)', () => {
  it('leave out hub invites and live tokens', async () => {
    const r = await auth('get', '/api/backup/snapshot', superTok);
    expect(r.status).toBe(200);
    const names = r.body.collections.map((c) => c.name);
    expect(names).not.toContain('HubInvite');
    expect(names).not.toContain('RefreshSession');
    for (const c of r.body.collections.filter((x) => x.name === 'ClientAccount')) {
      for (const d of c.docs) expect(d.onboardingToken).toBeUndefined();
    }
  });
});

describe('restore (M19, M97)', () => {
  it('needs the password, and never touches the audit log or closed periods', async () => {
    const noPw = await auth('post', '/api/backup/restore', superTok).send({ collection: 'Supplier', docs: [], confirm: 'RESTORE', replace: false });
    expect(noPw.status).toBe(403);
    for (const collection of ['AuditLog', 'ClosedPeriod']) {
      const r = await auth('post', '/api/backup/restore', superTok).send({ collection, docs: [], confirm: 'RESTORE', password: 'pw' });
      expect(r.status, collection).toBe(403);
    }
    const ok = await auth('post', '/api/backup/restore', superTok).send({ collection: 'Supplier', docs: [], confirm: 'RESTORE', replace: false, password: 'pw' });
    expect(ok.status).toBe(200);
  });

  it('restoring users keeps their two-step sign-in', async () => {
    await M('User').updateOne({ _id: staffId }, { $set: { totpEnabled: true, totpSecret: 'JBSWY3DPEHPK3PXP' } });
    const users = (await auth('get', '/api/backup/snapshot?collection=User', superTok)).body.docs;
    const r = await auth('post', '/api/backup/restore', superTok).send({ collection: 'User', docs: users, confirm: 'RESTORE', replace: true, password: 'pw' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const after = await M('User').findById(staffId).select('+totpSecret').lean();
    expect(after.totpEnabled).toBe(true);
    expect(after.totpSecret).toBe('JBSWY3DPEHPK3PXP');
    superTok = await loginStaff(app, 'DpSuper');
  });
});

describe('purge (M18)', () => {
  it('needs the password and has no audit-log category', async () => {
    const cats = (await auth('get', '/api/admin/purge-data/categories', superTok)).body.categories.map((c) => c.key);
    expect(cats).not.toContain('auditLog');
    const before = await M('AuditLog').countDocuments();
    const noPw = await auth('post', '/api/admin/purge-data', superTok).send({ confirmPhrase: 'PURGE', categories: ['orders'] });
    expect(noPw.status).toBe(403);
    const r = await auth('post', '/api/admin/purge-data', superTok).send({ confirmPhrase: 'PURGE', categories: ['orders', 'auditLog'], password: 'pw' });
    expect(r.status).toBe(200);
    expect(await M('AuditLog').countDocuments()).toBeGreaterThanOrEqual(before);
  });
});
