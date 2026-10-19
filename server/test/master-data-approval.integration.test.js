// Master-data approval: who we pay (supplier name, TIN, registered name, VAT
// status) and how much a client may owe (credit limit, terms) change only with
// an approver's sign-off - and every change, direct or approved, is recorded.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, supplierId, clientId;
const tok = {};
const as = (t, m, p) => request(app)[m](p).set('Authorization', `Bearer ${t}`);
const M = (n) => mongoose.model(n);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'mdBoss', role: 'superadmin' });
  await makeUser({ name: 'mdBuyer', role: 'staff', permissions: ['procurement.view', 'procurement.manage'] });
  await makeUser({ name: 'mdAcct', role: 'staff', permissions: ['accounting.view', 'accounting.manage'] });
  for (const n of ['mdBoss', 'mdBuyer', 'mdAcct']) tok[n] = await loginStaff(app, n);
  supplierId = String((await M('Supplier').create({ name: 'Metro Packaging', supplierCode: 'SUP-1', tin: '111-222-333' }))._id);
  clientId = String((await M('ClientAccount').create({ clientCode: 'CLT-1', username: 'md', name: 'Reyes Hardware', password: 'x', creditLimit: 50000, creditTermsDays: 30 }))._id);
}, 120000);
afterAll(async () => { await ctx.stop(); });

describe('supplier master data', () => {
  let requestId;
  it("a buyer's TIN change is held; the phone number saves at once", async () => {
    const r = await as(tok.mdBuyer, 'patch', `/api/suppliers/${supplierId}`).send({ tin: '999-888-777', phone: '0917 555 0000', reason: 'New BIR registration' });
    expect(r.status).toBe(200);
    expect(r.body.pendingApproval).toEqual(['Supplier TIN']);
    const s = await M('Supplier').findById(supplierId).lean();
    expect(s.tin).toBe('111-222-333');
    expect(s.phone).toBe('0917 555 0000');
    requestId = r.body.changeRequest._id;
  });
  it('an approver applies it, and the trail says who asked and who allowed it', async () => {
    const a = await as(tok.mdBoss, 'post', `/api/change-requests/${requestId}/approve`);
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    expect((await M('Supplier').findById(supplierId).lean()).tin).toBe('999-888-777');
    const log = await M('AuditLog').findOne({ action: 'SUPPLIER_TIN_CHANGED' }).lean();
    expect(log.details).toMatchObject({ requestedBy: 'mdBuyer', approvedBy: 'mdBoss', oldValue: '111-222-333', newValue: '999-888-777' });
  });
  it("an approver's own change applies directly", async () => {
    const r = await as(tok.mdBoss, 'patch', `/api/suppliers/${supplierId}`).send({ registeredName: 'Metro Packaging Corp.' });
    expect(r.body.changeRequest).toBeUndefined();
    expect((await M('Supplier').findById(supplierId).lean()).registeredName).toBe('Metro Packaging Corp.');
  });
});

describe('client credit lines', () => {
  it('an accountant files a credit-limit request instead of changing it', async () => {
    expect((await as(tok.mdAcct, 'patch', `/api/client-accounts/${clientId}`).send({ creditLimit: 90000 })).status).toBe(403);
    expect((await as(tok.mdAcct, 'post', `/api/client-accounts/${clientId}/credit-request`).send({ creditLimit: 90000 })).status).toBe(400);
    const r = await as(tok.mdAcct, 'post', `/api/client-accounts/${clientId}/credit-request`).send({ creditLimit: 90000, reason: 'Paid on time for a year' });
    expect(r.status).toBe(202);
    expect((await M('ClientAccount').findById(clientId).lean()).creditLimit).toBe(50000);
    const a = await as(tok.mdBoss, 'post', `/api/change-requests/${r.body.changeRequest._id}/approve`);
    expect(a.status).toBe(200);
    expect((await M('ClientAccount').findById(clientId).lean()).creditLimit).toBe(90000);
  });
  it("a superadmin's direct change is now recorded too", async () => {
    await as(tok.mdBoss, 'patch', `/api/client-accounts/${clientId}`).send({ creditTermsDays: 45 });
    const log = await M('AuditLog').findOne({ action: 'CLIENT_CREDIT_TERMS_CHANGED', 'details.viaApproval': false }).lean();
    expect(log.details).toMatchObject({ oldValue: 30, newValue: 45, approvedBy: 'mdBoss' });
  });
});
