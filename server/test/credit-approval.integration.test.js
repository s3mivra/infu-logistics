// Credit approval: a sale on account beyond the client's credit limit is
// refused - until an approver lets it through, with their PIN at the till (an
// approval bound to that client, that cashier, for two minutes) or as their
// own sale. The order keeps who approved it and the numbers they saw.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, clientId, otherClientId, productId;
const tok = {};
const as = (t, m, p) => request(app)[m](p).set('Authorization', `Bearer ${t}`);
const M = (n) => mongoose.model(n);
const sell = (t, body = {}, forClient = clientId) => as(t, 'post', '/api/orders').send({
  items: [{ productId, name: 'Pallet', price: 1000, quantity: 1 }], paymentMethod: 'On Account', clientAccountId: forClient, table: 'Takeout', ...body,
});

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'caBoss', role: 'superadmin' });
  await makeUser({ name: 'caCashier', role: 'cashier' });
  await makeUser({ name: 'caFinance', role: 'finance' });
  await makeUser({ name: 'caManager', role: 'manager' });
  for (const n of ['caBoss', 'caCashier', 'caFinance']) tok[n] = await loginStaff(app, n);
  // PINs: the finance officer may approve credit, the manager may not.
  await M('User').updateOne({ name: 'caFinance' }, { $set: { pinHash: await bcrypt.hash('4321', 4) } });
  await M('User').updateOne({ name: 'caManager' }, { $set: { pinHash: await bcrypt.hash('8765', 4) } });

  await as(tok.caBoss, 'patch', '/api/settings/creditLimitMode').send({ value: 'per_client' });
  const ClientAccount = M('ClientAccount');
  clientId = String((await ClientAccount.create({ clientCode: 'CA-1', username: 'caclient', name: 'Reyes Hardware', password: 'x', paymentMethod: 'On Account', creditLimit: 1500, isActive: true }))._id);
  otherClientId = String((await ClientAccount.create({ clientCode: 'CA-2', username: 'caother', name: 'Other', password: 'x', paymentMethod: 'On Account', creditLimit: 1500, isActive: true }))._id);
  await M('Category').create({ name: 'CACat', department: 'Logistics' });
  productId = String((await M('Product').create({ name: 'Pallet', category: 'CACat', basePrice: 1000 }))._id);
  await M('Inventory').create({ itemName: 'Pallet', stockQty: 100, unit: 'pcs', unitCost: 400 });
}, 120000);
afterAll(async () => { await ctx.stop(); });

describe('credit approval', () => {
  it('within the limit, a sale on account just goes through', async () => {
    const r = await sell(tok.caCashier);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.order.creditOverride?.approvedBy || '').toBe('');
  });

  it('over the limit it is refused and says an approver can release it', async () => {
    const r = await sell(tok.caCashier);
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ needsCreditApproval: true, clientId });
  });

  it("a cashier's own override flag is not enough", async () => {
    expect((await sell(tok.caCashier, { creditOverride: true })).status).toBe(409);
  });

  it("a manager's PIN without credit.approve is refused at the PIN step", async () => {
    const a = await as(tok.caCashier, 'post', '/api/users/authorize').send({ pin: '8765', permission: 'credit.approve', target: clientId });
    expect(a.status).toBe(403);
  });

  it("the finance officer's PIN releases it, and the order records who and why", async () => {
    const a = await as(tok.caCashier, 'post', '/api/users/authorize').send({ pin: '4321', permission: 'credit.approve', target: clientId });
    expect(a.status).toBe(200);
    const r = await sell(tok.caCashier, { creditApproval: a.body.approval });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.order.creditOverride).toMatchObject({ approvedBy: 'caFinance', limit: 1500, orderTotal: 1000 });
  });

  it('an approval for one client does not release another', async () => {
    // Put the other client over its limit first.
    await sell(tok.caBoss, {}, otherClientId);
    const a = await as(tok.caCashier, 'post', '/api/users/authorize').send({ pin: '4321', permission: 'credit.approve', target: clientId });
    const r = await sell(tok.caCashier, { creditApproval: a.body.approval }, otherClientId);
    expect(r.status).toBe(409);
  });

  it("an approver's own sale needs the explicit override, then records them", async () => {
    expect((await sell(tok.caFinance)).status).toBe(409);
    const r = await sell(tok.caFinance, { creditOverride: true });
    expect(r.status).toBe(200);
    expect(r.body.order.creditOverride.approvedBy).toBe('caFinance');
  });
});
