// One person's data: search, look up, export (Export All), erase (password,
// "ERASE"), with what the law keeps kept and said so (2026-11 audit, M76).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff, makeClient } from './helpers/harness.js';

let ctx, app, ownerTok, privTok, client, staff;
const M = (n) => mongoose.model(n);
const as = (tok) => ({
  get: (p) => request(app).get(p).set('Authorization', `Bearer ${tok}`),
  post: (p, b) => request(app).post(p).set('Authorization', `Bearer ${tok}`).send(b),
});
const order = (extra) => M('Order').create({ businessType: 'log', status: 'Completed', paymentMethod: 'Cash', total: 500, subtotal: 500, items: [{ name: 'X', quantity: 1, price: 500 }], ...extra });

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'PvOwner', role: 'superadmin' });
  await makeUser({ name: 'PvOfficer', role: 'staff', permissions: ['privacy.manage'] });
  ownerTok = await loginStaff(app, 'PvOwner');
  privTok = await loginStaff(app, 'PvOfficer');
  await makeClient({ username: 'maria' });
  client = await M('ClientAccount').findOneAndUpdate({ username: 'maria' }, { $set: { name: 'Maria Santos', phone: '0917 111 2222', email: 'maria@example.com' } }, { new: true }).lean();
  const id = String(client._id);
  await order({ orderNumber: 'PV-1', clientAccountId: id, customerName: 'Maria Santos', customerPhone: '0917 111 2222', deliveryAddress: '1 Mabini St' });
  await order({ orderNumber: 'PV-2', clientAccountId: id, customerName: 'Maria Santos', scPwdName: 'Maria Santos', scPwdIdNumber: 'SC-123' });
  await order({ orderNumber: 'PV-OLD', clientAccountId: id, customerName: 'Maria Santos', scPwdName: 'Maria Santos', scPwdIdNumber: 'SC-OLD', createdAt: new Date('2010-01-05') });
  await order({ orderNumber: 'PV-W1', customerName: 'Jose Walkin', customerPhone: '0999 000 1111', deliveryAddress: '9 Rizal Ave' });
  await makeUser({ name: 'Ben Staff', role: 'staff', permissions: ['pos.use'] });
  staff = await M('User').findOneAndUpdate({ name: 'Ben Staff' }, { $set: { sssNumber: '34-1234567-8', tin: '123-456-789' } }, { new: true }).lean();
  await M('PayrollRun').create({ reference: 'PAY-PV', periodStart: new Date(), periodEnd: new Date(), payDate: new Date(),
    lines: [{ employeeName: 'Ben Staff', employeeId: String(staff._id), sssNumber: '34-1234567-8', grossPay: 9000, netPay: 8000 }] });
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('finding a person', () => {
  it('searches clients, staff and walk-in customers', async () => {
    const r = await as(privTok).get('/api/privacy/search?q=Maria');
    expect(r.body.people.some((p) => p.type === 'client' && p.label.includes('Maria Santos'))).toBe(true);
    const w = await as(privTok).get('/api/privacy/search?q=0999');
    expect(w.body.people.find((p) => p.type === 'customer')).toMatchObject({ name: 'Jose Walkin', phone: '0999 000 1111' });
    const s = await as(privTok).get('/api/privacy/search?q=Ben');
    expect(s.body.people.some((p) => p.type === 'staff')).toBe(true);
  });

  it('needs the privacy permission', async () => {
    await makeUser({ name: 'PvCashier', role: 'staff', permissions: ['pos.use'] });
    const tok = await loginStaff(app, 'PvCashier');
    expect((await as(tok).get('/api/privacy/search?q=Maria')).status).toBe(403);
  });
});

describe('looking up and exporting', () => {
  it('shows what is held', async () => {
    const r = await as(privTok).get(`/api/privacy/person?type=client&id=${client._id}`);
    expect(r.body.counts.orders).toBe(3);
    expect(r.body.profile.email).toBe('maria@example.com');
  });

  it('exporting needs Export All as well', async () => {
    expect((await as(privTok).get(`/api/privacy/person?type=client&id=${client._id}&export=1`)).status).toBe(403);
    const r = await as(ownerTok).get(`/api/privacy/person?type=client&id=${client._id}&export=1`);
    expect(r.status).toBe(200);
    expect(r.body.data.orders.map((o) => o.orderNumber).sort()).toEqual(['PV-1', 'PV-2', 'PV-OLD']);
  });

  it('a staff export carries their profile and payroll, government numbers readable', async () => {
    const r = await as(ownerTok).get(`/api/privacy/person?type=staff&id=${staff._id}&export=1`);
    expect(r.body.data.profile.sssNumber).toBe('34-1234567-8');
    expect(r.body.data.payroll[0]).toMatchObject({ reference: 'PAY-PV', netPay: 8000 });
  });
});

describe('erasing', () => {
  it('asks for the password and the word ERASE', async () => {
    expect((await as(ownerTok).post('/api/privacy/erase', { type: 'client', id: client._id, password: 'pw' })).status).toBe(400);
    expect((await as(ownerTok).post('/api/privacy/erase', { type: 'client', id: client._id, confirm: 'ERASE', password: 'wrong' })).status).toBe(403);
  });

  it('a client: account and orders anonymised, amounts kept, recent SC/PWD details kept', async () => {
    const r = await as(ownerTok).post('/api/privacy/erase', { type: 'client', id: client._id, confirm: 'ERASE', password: 'pw' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.erased.orders).toBe(3);
    expect(r.body.kept.join(' ')).toMatch(/SC\/PWD/);
    const acct = await M('ClientAccount').findById(client._id).lean();
    expect(acct).toMatchObject({ phone: '', email: '', isActive: false });
    expect(acct.name).toMatch(/^Erased client /);
    const [o1, o2, old] = await Promise.all(['PV-1', 'PV-2', 'PV-OLD'].map((n) => M('Order').findOne({ orderNumber: n }).lean()));
    expect(o1).toMatchObject({ customerPhone: '', deliveryAddress: '', total: 500 });
    expect(o1.customerName).toMatch(/^Erased client /);
    expect(o2.scPwdName).toBe('Maria Santos');      // inside the tax retention period
    expect(old.scPwdName).toBe('');                 // past it
    const audit = await M('AuditLog').findOne({ action: 'PersonalData_ERASE' }).lean();
    expect(audit.userId).toBe('PvOwner');
    expect(JSON.stringify(audit)).not.toMatch(/maria@example\.com|0917 111 2222/);
  });

  it('a walk-in customer: their name and contact come off their orders', async () => {
    const r = await as(ownerTok).post('/api/privacy/erase', { type: 'customer', name: 'Jose Walkin', phone: '0999 000 1111', confirm: 'ERASE', password: 'pw' });
    expect(r.body.erased.orders).toBe(1);
    expect(await M('Order').findOne({ orderNumber: 'PV-W1' }).lean()).toMatchObject({ customerName: 'Erased customer', customerPhone: '', deliveryAddress: '' });
  });

  it('staff: the account is locked; government numbers stay while payroll is recent', async () => {
    const r = await as(ownerTok).post('/api/privacy/erase', { type: 'staff', id: staff._id, confirm: 'ERASE', password: 'pw' });
    expect(r.status).toBe(200);
    expect(r.body.kept.join(' ')).toMatch(/Government numbers stay/);
    expect((await request(app).post('/api/users/login').send({ name: 'Ben Staff', password: 'pw' })).status).toBe(401);
  });
});
