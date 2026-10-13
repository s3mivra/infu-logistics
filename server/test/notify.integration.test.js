// What the app sends by email (features/notify.js, lib/mailer.js). A test
// transport stands in for the mail server, so nothing leaves the machine and
// every message can be read back.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';
import { setMailTransportForTests, mailConfigured, sendMail } from '../lib/mailer.js';

let ctx, app, tok, tillTok;
const sentMail = [];
let failNext = false;
const as = (m, p, t = tok) => request(app)[m](p).set('Authorization', `Bearer ${t}`);
const M = (n) => mongoose.model(n);
const inDays = (n) => new Date(Date.now() + n * 86400000);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'mailOwner', role: 'superadmin' });
  await makeUser({ name: 'mailTill', role: 'staff', permissions: ['pos.use', 'orders.view'] });
  tok = await loginStaff(app, 'mailOwner');
  tillTok = await loginStaff(app, 'mailTill');
}, 120000);

afterAll(async () => { setMailTransportForTests(null); await ctx.stop(); });
beforeEach(() => { sentMail.length = 0; failNext = false; });

const useMail = () => setMailTransportForTests({
  sendMail: async (m) => { if (failNext) throw new Error('connection refused'); sentMail.push(m); return {}; },
});

describe('with no mail account set up', () => {
  it('says so, and sends nothing', async () => {
    setMailTransportForTests(null);
    expect(mailConfigured()).toBe(false);
    expect(await sendMail({ to: 'a@b.co', subject: 'x', text: 'y' })).toMatchObject({ ok: false });
    expect((await as('get', '/api/mail/status')).body).toMatchObject({ configured: false });
    expect((await as('post', '/api/mail/run-now')).status).toBe(409);
  });
});

describe('the mail settings', () => {
  it('need an owner email before the summary or the low-stock list can be switched on', async () => {
    useMail();
    expect((await as('put', '/api/mail/settings').send({ dailySummary: true })).status).toBe(400);
    expect((await as('put', '/api/mail/settings').send({ ownerEmail: 'not-an-email' })).status).toBe(400);
    const ok = await as('put', '/api/mail/settings').send({ ownerEmail: 'owner@example.com', dailySummary: true, lowStock: true, reminders: true, reminderDaysBefore: 3 });
    expect(ok.status).toBe(200);
    expect(ok.body.settings).toMatchObject({ ownerEmail: 'owner@example.com', dailySummary: true, lowStock: true, reminders: true });
  });

  it('are not for the till', async () => {
    expect((await as('get', '/api/mail/status', tillTok)).status).toBe(403);
    expect((await as('post', '/api/mail/run-now', tillTok)).status).toBe(403);
  });

  it('a test message goes to the owner, and a mail server that is down is reported, not thrown', async () => {
    expect((await as('post', '/api/mail/test')).status).toBe(200);
    expect(sentMail[0]).toMatchObject({ to: 'owner@example.com' });
    failNext = true;
    const down = await as('post', '/api/mail/test');
    expect(down.status).toBe(502);
    expect(down.body.error).toMatch(/refused/);
  });
});

describe('a statement by email', () => {
  it('goes only to the address on the client’s own record', async () => {
    const c = (await as('post', '/api/client-accounts').send({ username: 'mailco', password: 'secret123', name: 'Mail Co', email: 'accounts@mailco.example' })).body.client;
    const res = await as('post', `/api/clients/${c._id}/statement/email`).send({ subject: 'Statement\r\nBcc: thief@evil.example', text: 'Dear Mail Co, here is your statement of account.', to: 'thief@evil.example' });
    expect(res.status).toBe(200);
    expect(res.body.to).toBe('accounts@mailco.example');
    expect(sentMail).toHaveLength(1);
    expect(sentMail[0].to).toBe('accounts@mailco.example');
    expect(sentMail[0].subject).not.toMatch(/[\r\n]/);          // no smuggled header
  });

  it('is refused for a client with no email, an empty statement, or someone without the permission', async () => {
    const c = (await as('post', '/api/client-accounts').send({ username: 'nomailco', password: 'secret123', name: 'No Mail Co' })).body.client;
    expect((await as('post', `/api/clients/${c._id}/statement/email`).send({ text: 'Dear No Mail Co, here is your statement.' })).status).toBe(400);
    const withMail = await M('ClientAccount').findOne({ email: 'accounts@mailco.example' }).lean();
    expect((await as('post', `/api/clients/${withMail._id}/statement/email`).send({ text: 'short' })).status).toBe(400);
    expect((await as('post', `/api/clients/${withMail._id}/statement/email`, tillTok).send({ text: 'Dear Mail Co, here is your statement.' })).status).toBe(403);
    expect(sentMail).toHaveLength(0);
  });
});

describe('what goes out on its own each day', () => {
  it('sends the owner the summary and the low-stock list, and reminds a client once', async () => {
    const client = await M('ClientAccount').findOne({ email: 'accounts@mailco.example' }).lean();
    const invoice = (over) => M('Order').create({
      businessType: 'log', orderNumber: `MAIL-${Math.random().toString(36).slice(2, 7)}`, table: 'Pickup', items: [], subtotal: 500, total: 500,
      status: 'Completed', paymentMethod: 'Credit', clientAccountId: String(client._id), customerName: client.name, arSettled: false, ...over,
    });
    await invoice({ total: 800, arDueDate: inDays(-2) });      // overdue
    await invoice({ total: 200, arDueDate: inDays(2) });       // due inside the 3 days
    await invoice({ total: 9000, arDueDate: inDays(40) });     // far off: not mentioned
    await M('Inventory').create({ businessType: 'log', itemName: 'LOW BEANS', unit: 'kg', stockQty: 1, lowStockThreshold: 5, unitCost: 10 });

    const run = await as('post', '/api/mail/run-now');
    expect(run.status).toBe(200);
    expect(run.body.summary.ok).toBe(true);
    expect(run.body.reminders).toMatchObject({ sent: 1 });

    const toOwner = sentMail.filter(m => m.to === 'owner@example.com');
    expect(toOwner).toHaveLength(2);
    expect(toOwner.find(m => /summary/.test(m.subject)).text).toMatch(/Customers owe/);
    expect(toOwner.find(m => /running low/.test(m.subject)).text).toMatch(/LOW BEANS/);

    const reminder = sentMail.find(m => m.to === 'accounts@mailco.example');
    expect(reminder.subject).toMatch(/1,000\.00/);              // 800 + 200, not the 9,000
    expect(reminder.text).toMatch(/\(overdue\)/);
    expect(reminder.text).not.toMatch(/9,000/);

    // The next run, the same client is not written to again that week.
    sentMail.length = 0;
    const again = await as('post', '/api/mail/run-now');
    expect(again.body.reminders).toMatchObject({ sent: 0 });
    expect(sentMail.some(m => m.to === 'accounts@mailco.example')).toBe(false);
  });

  it('switched off, it sends nothing', async () => {
    await as('put', '/api/mail/settings').send({ dailySummary: false, lowStock: false, reminders: false });
    const run = await as('post', '/api/mail/run-now');
    expect(run.body).toMatchObject({ summary: null, lowStock: null, reminders: null });
    expect(sentMail).toHaveLength(0);
  });
});
