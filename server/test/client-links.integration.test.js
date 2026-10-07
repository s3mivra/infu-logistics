// Client links for the office: copy, never create. An onboarding link sets the
// client's own username and password, so issuing one stays superadmin-only;
// staff holding clients.links only see the ones already issued and still valid.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, fresh, onboarded, lapsed;
const tok = {};
const as = (t, m, p) => request(app)[m](p).set('Authorization', `Bearer ${t}`);
const M = (n) => mongoose.model(n);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'clOwner', role: 'superadmin' });
  await makeUser({ name: 'clOffice', role: 'staff', permissions: ['orders.view', 'clients.links'] });
  await makeUser({ name: 'clInviter', role: 'staff', permissions: ['orders.view', 'clients.invite'] });
  await makeUser({ name: 'clCashier', role: 'staff', permissions: ['orders.view', 'pos.use'] });
  tok.owner = await loginStaff(app, 'clOwner');
  tok.office = await loginStaff(app, 'clOffice');
  tok.cashier = await loginStaff(app, 'clCashier');
  tok.inviter = await loginStaff(app, 'clInviter');
  fresh = await M('ClientAccount').create({ name: 'Reyes Hardware', clientCode: 'CL-1', username: '_pending_cl-1', password: 'x' });
  onboarded = await M('ClientAccount').create({ name: 'Kasa Lokal', clientCode: 'CL-2', username: 'kasalokal', password: 'x' });
  lapsed = await M('ClientAccount').create({ name: 'Old Link Co', clientCode: 'CL-3', username: '_pos_cl-3', password: 'x', onboardingToken: 'expired-token', onboardingTokenExpiresAt: new Date(Date.now() - 1000) });
}, 120000);
afterAll(async () => { await ctx.stop(); });

describe('client links', () => {
  it('shows an onboarding link an admin issued, while it is valid', async () => {
    const issued = await as(tok.owner, 'post', `/api/client-accounts/${fresh._id}/onboard-link`);
    expect(issued.status).toBe(200);
    const r = await as(tok.office, 'get', '/api/client-accounts/links');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.signInPath).toBe('/client-login');
    const row = r.body.clients.find(c => c.name === 'Reyes Hardware');
    expect(row.onboardingPath).toBe(`/client-onboard/${issued.body.token}`);
    expect(row.hasLogin).toBe(false);
  });

  it('never shows an expired link, and marks a client who already has a login', async () => {
    const r = await as(tok.office, 'get', '/api/client-accounts/links');
    expect(r.body.clients.find(c => c.name === 'Old Link Co').onboardingPath).toBeNull();
    expect(r.body.clients.find(c => c.name === 'Kasa Lokal')).toMatchObject({ hasLogin: true, onboardingPath: null });
  });

  it('reading the links changes nothing', async () => {
    const before = await M('ClientAccount').findById(fresh._id).lean();
    await as(tok.office, 'get', '/api/client-accounts/links');
    const after = await M('ClientAccount').findById(fresh._id).lean();
    expect(after.onboardingToken).toBe(before.onboardingToken);
    expect(String(after.onboardingTokenExpiresAt)).toBe(String(before.onboardingTokenExpiresAt));
  });

  it('office staff can copy but not issue a link', async () => {
    const r = await as(tok.office, 'post', `/api/client-accounts/${onboarded._id}/onboard-link`);
    expect(r.status).toBe(403);
    expect((await M('ClientAccount').findById(onboarded._id).lean()).onboardingToken).toBeFalsy();
  });

  it('without the permission, no links at all', async () => {
    expect((await as(tok.cashier, 'get', '/api/client-accounts/links')).status).toBe(403);
  });
});

// A brand-new client from a name only. Safe for office staff: it cannot touch
// an existing account, and the client picks their own login on the link.
describe('new client link from a name', () => {
  it('staff with Create client links create one and get its link', async () => {
    const r = await as(tok.inviter, 'post', '/api/client-accounts/invite').send({ name: 'bagong kape' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.client.onboardingPath).toMatch(/^\/client-onboard\/[0-9a-f]{48}$/);
    const made = await M('ClientAccount').findById(r.body.client._id).lean();
    expect(made.name).toBe('BAGONG KAPE');
    expect(made.username.startsWith('_pending_')).toBe(true);
    // The link works, and the client fills in the rest.
    const token = r.body.client.onboardingPath.split('/').pop();
    expect((await request(app).get(`/api/client-onboard/${token}`)).body.client.name).toBe('BAGONG KAPE');
    const done = await request(app).post(`/api/client-onboard/${token}`).send({ name: 'BAGONG KAPE', phone: '09171234567', username: 'bagongkape', password: 'secret123' });
    expect(done.body.success).toBe(true);
  });

  it('refuses a name that already exists, whatever the case', async () => {
    const r = await as(tok.inviter, 'post', '/api/client-accounts/invite').send({ name: 'KASA LOKAL' });
    expect(r.status).toBe(409);
    expect(await M('ClientAccount').countDocuments({ name: /kasa lokal/i })).toBe(1);
  });

  it('a blank name makes a link the client names themselves', async () => {
    const r = await as(tok.inviter, 'post', '/api/client-accounts/invite').send({ name: '  ' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.client.namePending).toBe(true);
    expect(r.body.client.name).toMatch(/^NEW CLIENT CUS-/);
  });

  it('copying links alone is not enough to create one', async () => {
    expect((await as(tok.office, 'post', '/api/client-accounts/invite').send({ name: 'Copy Only Co' })).status).toBe(403);
  });

  it('without the permission, cannot create one', async () => {
    expect((await as(tok.cashier, 'post', '/api/client-accounts/invite').send({ name: 'Sneaky Co' })).status).toBe(403);
    expect(await M('ClientAccount').exists({ name: 'Sneaky Co' })).toBeFalsy();
  });
});

describe('adding and deleting clients', () => {
  let adder, deleter;
  beforeAll(async () => {
    await makeUser({ name: 'clAdder', role: 'staff', permissions: ['orders.view', 'clients.create'] });
    await makeUser({ name: 'clDeleter', role: 'staff', permissions: ['orders.view', 'clients.delete'] });
    adder = await loginStaff(app, 'clAdder');
    deleter = await loginStaff(app, 'clDeleter');
  });

  it('adds a client with details and hands back a link for the login', async () => {
    const r = await as(adder, 'post', '/api/client-accounts').send({ name: 'tindahan ni aling nena', phone: '09170000000', paymentMethod: 'Cash', creditLimit: 999999 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.onboardingPath).toMatch(/^\/client-onboard\//);
    const c = await M('ClientAccount').findById(r.body.client._id).lean();
    expect(c.name).toBe('TINDAHAN NI ALING NENA');
    expect(c.username.startsWith('_pending_')).toBe(true);
    expect(c.creditLimit).toBeNull();   // credit is not staff's to set here
  });

  it('staff cannot choose a client login', async () => {
    const r = await as(adder, 'post', '/api/client-accounts').send({ name: 'Login Picker', username: 'picked', password: 'secret123' });
    expect(r.status).toBe(403);
    expect(await M('ClientAccount').exists({ username: 'picked' })).toBeFalsy();
  });

  it('the owner still can, as before', async () => {
    const r = await as(tok.owner, 'post', '/api/client-accounts').send({ name: 'Owner Made', username: 'ownermade', password: 'secret123', creditLimit: 5000 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.onboardingPath).toBeUndefined();
    expect((await M('ClientAccount').findOne({ username: 'ownermade' }).lean()).creditLimit).toBe(5000);
  });

  it('adding needs the permission', async () => {
    expect((await as(tok.cashier, 'post', '/api/client-accounts').send({ name: 'Nope Co' })).status).toBe(403);
    expect((await as(deleter, 'post', '/api/client-accounts').send({ name: 'Nope Co' })).status).toBe(403);
  });

  it('deletes a client with no history', async () => {
    const c = await M('ClientAccount').create({ name: 'Empty Co', clientCode: 'CL-9', username: '_pending_cl-9', password: 'x' });
    const r = await as(deleter, 'delete', `/api/client-accounts/${c._id}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await M('ClientAccount').exists({ _id: c._id })).toBeFalsy();
  });

  it('refuses to delete a client that has orders or a credit balance', async () => {
    const withOrder = await M('ClientAccount').create({ name: 'Busy Co', clientCode: 'CL-10', username: '_pending_cl-10', password: 'x' });
    await M('Order').collection.insertOne({ clientId: String(withOrder._id), orderNumber: 'T-1', items: [], total: 0 });
    const r1 = await as(deleter, 'delete', `/api/client-accounts/${withOrder._id}`);
    expect(r1.status).toBe(409);
    expect(r1.body.error).toMatch(/orders/);
    const withCredit = await M('ClientAccount').create({ name: 'Credit Co', clientCode: 'CL-11', username: '_pending_cl-11', password: 'x', creditBalance: 150 });
    expect((await as(deleter, 'delete', `/api/client-accounts/${withCredit._id}`)).status).toBe(409);
    expect(await M('ClientAccount').countDocuments({ _id: { $in: [withOrder._id, withCredit._id] } })).toBe(2);
  });

  it('deleting needs the permission', async () => {
    const c = await M('ClientAccount').create({ name: 'Keep Co', clientCode: 'CL-12', username: '_pending_cl-12', password: 'x' });
    expect((await as(adder, 'delete', `/api/client-accounts/${c._id}`)).status).toBe(403);
    expect((await as(tok.office, 'delete', `/api/client-accounts/${c._id}`)).status).toBe(403);
  });
});

describe('price tier on a client', () => {
  it('the owner sets a tier when adding a client, and the list shows it', async () => {
    const r = await as(tok.owner, 'post', '/api/client-accounts').send({ name: 'Tier Buyer', segments: ['Dealer'] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const list = await as(tok.owner, 'get', '/api/clients/summary');
    expect(list.body.clients.find(c => c.name === 'TIER BUYER').segments).toEqual(['Dealer']);
  });

  it('the owner can change it later', async () => {
    const c = await M('ClientAccount').findOne({ name: 'TIER BUYER' }).lean();
    const r = await as(tok.owner, 'patch', `/api/client-accounts/${c._id}`).send({ segments: ['Wholesale'] });
    expect(r.status).toBe(200);
    expect((await M('ClientAccount').findById(c._id).lean()).segments).toEqual(['Wholesale']);
  });

  it('staff adding a client cannot give it a tier, and cannot change one', async () => {
    await makeUser({ name: 'clTierAdder', role: 'staff', permissions: ['orders.view', 'clients.create'] });
    const t = await loginStaff(app, 'clTierAdder');
    const r = await as(t, 'post', '/api/client-accounts').send({ name: 'No Tier Co', segments: ['Dealer'] });
    expect(r.status).toBe(200);
    const c = await M('ClientAccount').findById(r.body.client._id).lean();
    expect(c.segments).toEqual([]);
    expect((await as(t, 'patch', `/api/client-accounts/${c._id}`).send({ segments: ['Dealer'] })).status).toBe(403);
  });
});

describe('client list at the till', () => {
  it('a cashier sees the clients to pick, without their private details', async () => {
    const r = await as(tok.cashier, 'get', '/api/client-accounts');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const row = r.body.clients.find(c => c.name === 'Kasa Lokal');
    expect(row).toBeTruthy();
    expect(row.clientCode).toBeTruthy();
    for (const hidden of ['username', 'password', 'phone', 'email', 'creditLimit', 'onboardingToken']) expect(row[hidden]).toBeUndefined();
  });

  it('the owner still gets the full records', async () => {
    const r = await as(tok.owner, 'get', '/api/client-accounts');
    expect(r.body.clients.find(c => c.name === 'Kasa Lokal').username).toBe('kasalokal');
  });

  it('someone with neither the till nor orders gets nothing', async () => {
    await makeUser({ name: 'clNobody', role: 'staff', permissions: ['inventory.view'] });
    const t = await loginStaff(app, 'clNobody');
    expect((await as(t, 'get', '/api/client-accounts')).status).toBe(403);
  });
});

describe('a link with no name on it', () => {
  it('lets the client supply their own name when they sign up', async () => {
    const made = await request(app).post('/api/client-accounts/invite').set('Authorization', `Bearer ${tok.inviter}`).send({});
    expect(made.status, JSON.stringify(made.body)).toBe(200);
    expect(made.body.client.namePending).toBe(true);
    const path = made.body.client.onboardingPath.replace('/client-onboard/', '/api/client-onboard/');

    const seen = await request(app).get(path);
    expect(seen.body.client).toMatchObject({ name: '', nameRequired: true });

    const blank = await request(app).post(path).send({ username: 'nonameuser', password: 'secret12' });
    expect(blank.status).toBe(400);
    expect(blank.body.error).toMatch(/name/i);

    const done = await request(app).post(path).send({ name: 'Fresh Bakes Cafe', username: 'nonameuser', password: 'secret12' });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.client.name).toBe('FRESH BAKES CAFE');
    const saved = await mongoose.model('ClientAccount').findOne({ username: 'nonameuser' }).lean();
    expect([saved.name, saved.namePending]).toEqual(['FRESH BAKES CAFE', false]);
  });
});
