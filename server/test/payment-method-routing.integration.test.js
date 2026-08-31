// Payment method routing: a COA sub-account under a payment-relevant parent
// (111000 Cash on Hand, 112000 Cash in Bank, 113000 E-Wallet, 115000 Checks on
// Hand, 220000 Accounts Payable-shaped On Account) IS a payment method. Adding
// one must show up on GET /api/payment-methods/active - the single endpoint
// every ordering surface (POS, client portal, QR menu) reads instead of
// hardcoding tender names - and must fire the socket event that tells already
// -connected clients to refetch instead of polling.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, superTok;
const auth = (m, p, t) => request(app)[m](p).set('Authorization', `Bearer ${t}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'pmrSuper', role: 'superadmin' });
  superTok = await loginStaff(app, 'pmrSuper');
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('GET /api/payment-methods/active', () => {
  it('is public - no token required, same as the product menu', async () => {
    const res = await request(app).get('/api/payment-methods/active');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('always includes the canonical selectable tenders', async () => {
    const res = await request(app).get('/api/payment-methods/active');
    const names = res.body.methods.map(m => m.name);
    for (const n of ['Cash', 'Bank Transfer', 'Check', 'QR', 'GCash', 'On Account']) {
      expect(names).toContain(n);
    }
  });

  it('excludes delivery-partner channels - those are dispatch labels, not customer-selectable tenders', async () => {
    const res = await request(app).get('/api/payment-methods/active');
    const names = res.body.methods.map(m => m.name);
    expect(names).not.toContain('Grab Delivery');
    expect(names).not.toContain('Lalamove');
    expect(names).not.toContain('Manual Delivery');
  });
});

describe('adding a COA sub-account under a payment parent', () => {
  it('instantly appears in the active payment methods list', async () => {
    const before = await request(app).get('/api/payment-methods/active');
    expect(before.body.methods.some(m => m.name === 'GoTyme')).toBe(false);

    const created = await auth('post', '/api/accounts', superTok)
      .send({ parentCode: '113000', name: 'GoTyme' });
    expect(created.status).toBe(200);

    const after = await request(app).get('/api/payment-methods/active');
    const row = after.body.methods.find(m => m.name === 'GoTyme');
    expect(row).toBeTruthy();
    expect(row.kind).toBe('custom');
    expect(row.group).toBe('E-Wallets');
    expect(row.code).toBe(created.body.account.code);
  });

  it('a sub-account under a non-payment parent (e.g. an expense account) does not appear', async () => {
    const created = await auth('post', '/api/accounts', superTok)
      .send({ parentCode: '760000', name: 'Random Expense Sub' });
    expect(created.status).toBe(200);

    const res = await request(app).get('/api/payment-methods/active');
    expect(res.body.methods.some(m => m.name === 'Random Expense Sub')).toBe(false);
  });

  it('does not duplicate a canonical tender when a custom child shares its name', async () => {
    // The auto-bind case (accountForPaymentMethod) - a sub-account named
    // "GCash" under E-Wallet ROUTES the existing GCash tender, it is not a
    // second, separate payment method.
    await auth('post', '/api/accounts', superTok).send({ parentCode: '113000', name: 'GCash' });
    const res = await request(app).get('/api/payment-methods/active');
    expect(res.body.methods.filter(m => m.name === 'GCash')).toHaveLength(1);
  });
});

describe('deactivating a payment method without deleting it', () => {
  it('PATCH .../active removes it from the list but keeps the account', async () => {
    const created = await auth('post', '/api/accounts', superTok)
      .send({ parentCode: '111000', name: 'Discontinued Wallet' });
    const id = created.body.account._id;

    const off = await auth('patch', `/api/accounts/${id}/active`, superTok).send({ isActive: false });
    expect(off.status).toBe(200);

    const list = await request(app).get('/api/payment-methods/active');
    expect(list.body.methods.some(m => m.name === 'Discontinued Wallet')).toBe(false);

    // Still a real account - not deleted, still resolvable for old journal entries.
    const stillThere = await mongoose.model('Account').findById(id).lean();
    expect(stillThere).toBeTruthy();
    expect(stillThere.isActive).toBe(false);
  });

  it('re-activating brings it back', async () => {
    const created = await auth('post', '/api/accounts', superTok)
      .send({ parentCode: '111000', name: 'Toggle Me' });
    const id = created.body.account._id;

    await auth('patch', `/api/accounts/${id}/active`, superTok).send({ isActive: false });
    await auth('patch', `/api/accounts/${id}/active`, superTok).send({ isActive: true });

    const list = await request(app).get('/api/payment-methods/active');
    expect(list.body.methods.some(m => m.name === 'Toggle Me')).toBe(true);
  });

  it('rejects a non-boolean isActive', async () => {
    const created = await auth('post', '/api/accounts', superTok)
      .send({ parentCode: '111000', name: 'Bad Toggle Target' });
    const res = await auth('patch', `/api/accounts/${created.body.account._id}/active`, superTok)
      .send({ isActive: 'yes' });
    expect(res.status).toBe(400);
  });

  it('cannot toggle a canonical account - only custom ones exist to toggle', async () => {
    const res = await auth('patch', '/api/accounts/000000000000000000000000/active', superTok)
      .send({ isActive: false });
    expect(res.status).toBe(404);
  });
});

describe('a renamed or deleted custom account updates the list too', () => {
  it('rename changes the listed name', async () => {
    const created = await auth('post', '/api/accounts', superTok)
      .send({ parentCode: '112000', name: 'Old Bank Name' });
    const id = created.body.account._id;

    await auth('put', `/api/accounts/${id}`, superTok).send({ name: 'New Bank Name' });

    const res = await request(app).get('/api/payment-methods/active');
    expect(res.body.methods.some(m => m.name === 'Old Bank Name')).toBe(false);
    expect(res.body.methods.some(m => m.name === 'New Bank Name')).toBe(true);
  });

  it('a delete that succeeds (no journal history) removes it from the list', async () => {
    const created = await auth('post', '/api/accounts', superTok)
      .send({ parentCode: '112000', name: 'Never Used Bank' });
    const id = created.body.account._id;

    const del = await auth('delete', `/api/accounts/${id}`, superTok).send();
    expect(del.status).toBe(200);

    const res = await request(app).get('/api/payment-methods/active');
    expect(res.body.methods.some(m => m.name === 'Never Used Bank')).toBe(false);
  });
});
