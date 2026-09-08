// Importing the lists a business already has on paper.
//
// Both screens already offered a template and an export. Neither had a way to
// put a filled-in sheet back, which makes the template a dead end: it invites
// someone to spend an evening typing forty suppliers into a spreadsheet that
// nothing can read.
//
// Bills are the sharper case. On the day you go live you have a drawer of
// unpaid invoices, and they have to land as PENDING - nothing posts until a
// person has looked at each one. Approving a drawer of payables in bulk would
// book liabilities nobody actually read.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const M = (n) => mongoose.model(n);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'ImpSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'ImpSuper');
}, 120000);

afterAll(async () => { await ctx.stop(); });

beforeEach(async () => {
  for (const n of ['Supplier', 'Bill', 'JournalEntry']) await M(n).deleteMany({});
});

const importSuppliers = (rows) => auth('post', '/api/suppliers/import').send({ rows });
const importBills = (rows) => auth('post', '/api/bills/import').send({ rows });

describe('importing suppliers', () => {
  it('creates them from the sheet', async () => {
    const res = await importSuppliers([
      { name: 'Metro Beans', contactPerson: 'Joy Cruz', phone: '0917 555 0100', email: 'JOY@metro.ph', paymentTerms: '30 days' },
      { name: 'Alaska Distribution', address: 'Quezon City' },
    ]);
    expect(res.body.created).toBe(2);
    expect(await M('Supplier').countDocuments({})).toBe(2);

    const metro = await M('Supplier').findOne({ name: 'Metro Beans' }).lean();
    expect(metro.supplierCode).toMatch(/^SUP-/);
    expect(metro.email).toBe('joy@metro.ph');       // normalised, as the form does
    expect(metro.paymentTerms).toBe('30 days');      // the export column now round-trips
  }, 30000);

  it('reads the template’s own column headings', async () => {
    // The person filling the sheet in reads "Name", not `name`.
    const res = await importSuppliers([{ Name: 'Gokuji Tea', Contact: 'Ken', Terms: 'COD' }]);
    expect(res.body.created).toBe(1);
    const s = await M('Supplier').findOne({}).lean();
    expect(s.name).toBe('Gokuji Tea');
    expect(s.paymentTerms).toBe('COD');
  }, 30000);

  it('skips one bad row and keeps the rest', async () => {
    const res = await importSuppliers([
      { name: 'Good One' },
      { name: '' },                 // no name
      { name: 'Another Good One' },
    ]);
    expect(res.body.created).toBe(2);
    expect(res.body.skipped).toHaveLength(1);
    expect(res.body.skipped[0].row).toBe(2);
  }, 30000);

  it('does not overwrite a supplier that already exists', async () => {
    await importSuppliers([{ name: 'Metro Beans', phone: '111' }]);
    const res = await importSuppliers([{ name: 'metro beans', phone: '999' }]);
    // Re-importing a corrected sheet is normal; clobbering an edit someone
    // made by hand since is not.
    expect(res.body.created).toBe(0);
    expect(res.body.skipped[0].error).toMatch(/already exists/i);
    expect((await M('Supplier').findOne({}).lean()).phone).toBe('111');
  }, 30000);

  it('refuses a sheet too big to be a supplier list', async () => {
    const res = await importSuppliers(Array.from({ length: 501 }, (_, i) => ({ name: `S${i}` })));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at most/i);
  }, 30000);
});

describe('importing open bills', () => {
  beforeEach(async () => {
    await importSuppliers([{ name: 'Metro Beans' }]);
  });

  it('creates them against the named supplier', async () => {
    const res = await importBills([
      { supplier: 'Metro Beans', description: 'March beans', amount: 12000, expenseAccountCode: '510000', dueDate: '2026-04-15' },
    ]);
    expect(res.body.created).toBe(1);
    const bill = await M('Bill').findOne({}).lean();
    expect(bill.supplierName).toBe('Metro Beans');
    expect(bill.amount).toBe(12000);
    expect(bill.billNumber).toMatch(/^BILL-/);
  }, 30000);

  it('lands them Pending, posting nothing', async () => {
    await importBills([
      { supplier: 'Metro Beans', description: 'March beans', amount: 12000, expenseAccountCode: '510000' },
    ]);
    const bill = await M('Bill').findOne({}).lean();
    expect(bill.status).toBe('Pending');
    // The failure this prevents: a drawer of invoices booked as payables
    // before anyone has read them.
    expect(await M('JournalEntry').countDocuments({})).toBe(0);
  }, 30000);

  it('says so, rather than letting "imported" read as "posted"', async () => {
    const res = await importBills([
      { supplier: 'Metro Beans', description: 'March beans', amount: 12000, expenseAccountCode: '510000' },
    ]);
    expect(res.body.note).toMatch(/nothing has posted/i);
    expect(res.body.totalAmount).toBe(12000);
  }, 30000);

  it('refuses a supplier it has never heard of', async () => {
    const res = await importBills([
      { supplier: 'Nobody Ltd', description: 'x', amount: 100, expenseAccountCode: '510000' },
    ]);
    expect(res.body.created).toBe(0);
    expect(res.body.skipped[0].error).toMatch(/no supplier named/i);
  }, 30000);

  it('insists on the account the bill will be charged to', async () => {
    // Without it the bill can never be approved, which is a dead end better
    // found at import than three weeks later.
    const res = await importBills([
      { supplier: 'Metro Beans', description: 'March beans', amount: 12000 },
    ]);
    expect(res.body.created).toBe(0);
    expect(res.body.skipped[0].error).toMatch(/not an account/i);
  }, 30000);

  it('keeps the good rows when one is wrong', async () => {
    const res = await importBills([
      { supplier: 'Metro Beans', description: 'Good', amount: 100, expenseAccountCode: '510000' },
      { supplier: 'Metro Beans', description: 'Bad', amount: -5, expenseAccountCode: '510000' },
      { supplier: 'Metro Beans', description: 'Also good', amount: 200, expenseAccountCode: '510000' },
    ]);
    expect(res.body.created).toBe(2);
    expect(res.body.skipped).toHaveLength(1);
    expect(res.body.skipped[0].row).toBe(2);
  }, 30000);

  it('still books the payable when one is approved afterwards', async () => {
    await importBills([
      { supplier: 'Metro Beans', description: 'March beans', amount: 12000, expenseAccountCode: '510000' },
    ]);
    const bill = await M('Bill').findOne({}).lean();
    const res = await auth('post', `/api/bills/${bill._id}/approve`).send({});
    expect(res.body.success).toBe(true);

    const je = await M('JournalEntry').findOne({}).lean();
    expect(je.lines.find(l => l.accountCode === '510000').debit).toBe(12000);
    expect(je.lines.find(l => l.accountCode === '220000').credit).toBe(12000);
  }, 30000);
});

describe('importing a client list', () => {
  const importClients = (rows) => auth('post', '/api/client-accounts/import').send({ rows });

  beforeEach(async () => { await M('ClientAccount').deleteMany({}); });

  it('creates the records from the sheet', async () => {
    const res = await importClients([
      { name: 'Kasa Lokal', email: 'AR@kasa.ph', phone: '0917 555 0101', creditLimit: 50000, creditTermsDays: 30, segments: 'wholesale, cafe' },
      { Name: 'Sari Store', 'Payment Method': 'Account' },
    ]);
    expect(res.body.created).toBe(2);

    const kasa = await M('ClientAccount').findOne({ name: 'Kasa Lokal' }).lean();
    expect(kasa.clientCode).toMatch(/^CUS-1000/);
    expect(kasa.email).toBe('ar@kasa.ph');
    expect(kasa.creditLimit).toBe(50000);
    expect(kasa.segments).toEqual(['wholesale', 'cafe']);
  }, 30000);

  it('sets no password anyone could use', async () => {
    await importClients([{ name: 'Kasa Lokal' }]);
    const c = await M('ClientAccount').findOne({}).lean();
    // The whole point: a spreadsheet does not get to mint logins. The account
    // exists, and nobody can sign in to it yet.
    expect(c.username).toMatch(/^_pending_/);
    expect(c.password).toBeTruthy();
    const login = await request(app).post('/api/client-auth/login')
      .send({ username: c.username, password: 'password' });
    expect(login.status).not.toBe(200);
  }, 30000);

  it('hands back a link per client instead', async () => {
    const res = await importClients([{ name: 'Kasa Lokal' }]);
    const row = res.body.clients[0];
    // The path the app actually serves, not one that looks plausible.
    expect(row.onboardingPath).toMatch(/^\/client-onboard\/[a-f0-9]{48}$/);
    expect(res.body.note).toMatch(/picks their own username/i);
  }, 30000);

  it('lets the client redeem that link and choose their own credentials', async () => {
    const res = await importClients([{ name: 'Kasa Lokal' }]);
    const token = res.body.clients[0].onboardingPath.split('/').pop();

    // The client opens the link: it tells them who it is for, without auth.
    const peek = await request(app).get(`/api/client-onboard/${token}`);
    expect(peek.body.client.name).toBe('Kasa Lokal');

    const done = await request(app).post(`/api/client-onboard/${token}`)
      .send({ name: 'Kasa Lokal', username: 'kasalokal', password: 'ChosenByThem1!' });
    expect(done.body.success).toBe(true);

    const login = await request(app).post('/api/client-auth/login')
      .send({ username: 'kasalokal', password: 'ChosenByThem1!' });
    expect(login.status).toBe(200);
  }, 30000);

  it('skips a duplicate rather than making a second account', async () => {
    await importClients([{ name: 'Kasa Lokal' }]);
    const res = await importClients([{ name: 'kasa lokal' }]);
    expect(res.body.created).toBe(0);
    expect(res.body.skipped[0].error).toMatch(/already exists/i);
  }, 30000);

  it('rejects a bad email without losing the good rows', async () => {
    const res = await importClients([
      { name: 'Good Client' },
      { name: 'Bad Email', email: 'not-an-address' },
    ]);
    expect(res.body.created).toBe(1);
    expect(res.body.skipped[0].error).toMatch(/email/i);
  }, 30000);
});
