// What the app sends by email (features/notify.js, lib/mailer.js). A test
// transport stands in for the mail server, so nothing leaves the machine and
// every message can be read back.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { lastWeek, lastMonth } from '../features/notify.js';
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

describe('the week and month in review', () => {
  it('go to the owner with sales, best sellers and what is owed, once switched on', async () => {
    await as('put', '/api/mail/settings').send({ ownerEmail: 'owner@example.com', dailySummary: false, lowStock: false, reminders: false, weeklyReport: true, monthlyReport: true });
    const run = await as('post', '/api/mail/run-now');
    expect(run.status).toBe(200);
    expect(run.body.weekly.ok).toBe(true);
    expect(run.body.monthly.ok).toBe(true);
    const week = sentMail.find(m => /week of/.test(m.subject));
    const month = sentMail.find(m => /month in review/.test(m.subject));
    expect(week.text).toMatch(/Week in review, \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}/);
    expect(month.text).toMatch(/Customers owe/);
  });

  it('cover last Monday-to-Sunday and last calendar month', async () => {
    // Wednesday 2026-10-21 -> Mon 12th to Sun 18th; 1 March -> all of February.
    expect(lastWeek('2026-10-21', 3)).toEqual(['2026-10-12', '2026-10-18', '2026-10-05', '2026-10-11']);
    expect(lastMonth('2026-03-01')).toEqual(['2026-02-01', '2026-02-28', '2026-01-01', '2026-01-31']);
  });
});

describe('the low-stock list', () => {
  it('groups items by the supplier they were last bought from, with a suggested quantity', async () => {
    const inv = await M('Inventory').create({ businessType: 'log', itemName: 'MILK', unit: 'L', stockQty: 2, lowStockThreshold: 10, unitCost: 80 });
    await M('PurchaseOrder').create({ businessType: 'log', poNumber: 'PO-T-1', supplier: 'Dairy Co', status: 'Complete',
      lines: [{ invId: inv._id, itemName: 'MILK', unit: 'L', orderedQty: 24, unitCost: 85 }] });
    await as('put', '/api/mail/settings').send({ ownerEmail: 'owner@example.com', lowStock: true, dailySummary: false, reminders: false, weeklyReport: false, monthlyReport: false });
    await as('post', '/api/mail/run-now');
    const low = sentMail.find(m => /running low/.test(m.subject));
    expect(low.text).toMatch(/Dairy Co:\n\s+- MILK.*order about 24 at ~PHP 85\.00/);
  });
});

describe('test send (superadmin only)', () => {
  it('previews any automatic email without a mail account, and refuses anyone but a superadmin', async () => {
    setMailTransportForTests(null);
    expect(mailConfigured()).toBe(false);          // the test env has no SMTP account
    const p = await as('post', '/api/mail/test-preview').send({ kind: 'weekly' });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    expect(p.body.subject).toMatch(/week of \d{4}-\d{2}-\d{2}/);
    expect(p.body.text).toMatch(/Week in review/);
    expect((await as('post', '/api/mail/test-send').send({ kind: 'weekly' })).status).toBe(409);   // nothing to send with

    await makeUser({ name: 'mailManager', role: 'staff', permissions: ['settings.manage'] });
    const mgr = await loginStaff(app, 'mailManager');
    expect((await as('get', '/api/mail/status', mgr)).status).toBe(200);              // may manage mail...
    expect((await as('post', '/api/mail/test-preview', mgr).send({ kind: 'summary' })).status).toBe(403);   // ...but not test it
    expect((await as('post', '/api/mail/test-send', tillTok).send({ kind: 'summary' })).status).toBe(403);
    expect((await as('post', '/api/mail/test-preview').send({ kind: 'nope' })).status).toBe(400);
  });

  it('sends a [TEST] copy to the owner only - never the client - and marks nothing as sent', async () => {
    useMail();
    await as('put', '/api/mail/settings').send({ ownerEmail: 'owner@example.com', reminders: false });
    const before = (await M('Settings').findOne({ key: 'mailRemindersSent' }).lean())?.value || {};

    const prev = await as('post', '/api/mail/test-preview').send({ kind: 'reminder' });
    expect(prev.status).toBe(200);
    expect(prev.body.empty).toBeUndefined();       // the overdue invoices from the daily-run test
    expect(prev.body.wouldGoTo).toBeTruthy();

    const r = await as('post', '/api/mail/test-send').send({ kind: 'reminder' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(sentMail).toHaveLength(1);
    expect(sentMail[0].to).toBe('owner@example.com');
    expect(sentMail[0].subject).toMatch(/^\[TEST\] .*payment reminder/);
    expect((await M('Settings').findOne({ key: 'mailRemindersSent' }).lean())?.value || {}).toEqual(before);
  });
});

describe('the mail account, set up in the app (superadmin)', () => {
  const account = { host: 'smtp.gmail.com', port: 587, user: 'shop@gmail.com', pass: 'abcd efgh ijkl mnop', from: 'Infusions <shop@gmail.com>' };

  it('saves it with the password sealed, and never hands the password back', async () => {
    setMailTransportForTests(null);
    expect((await as('get', '/api/mail/status')).body.configured).toBe(false);

    const put = await as('put', '/api/mail/account').send(account);
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(JSON.stringify(put.body)).not.toContain('abcd');
    expect(put.body.account).toMatchObject({ host: 'smtp.gmail.com', user: 'shop@gmail.com', hasPassword: true });

    const stored = (await M('Settings').findOne({ key: 'mailAccount' }).lean()).value;
    expect(stored.passSealed).toMatch(/^v1\./);
    expect(JSON.stringify(stored)).not.toMatch(/abcd|efgh/);

    const st = (await as('get', '/api/mail/status')).body;
    expect(st).toMatchObject({ configured: true, source: 'settings', from: 'Infusions <shop@gmail.com>' });
    const got = (await as('get', '/api/mail/account')).body;
    expect(JSON.stringify(got)).not.toContain('abcd');
  });

  it('a blank password keeps the saved one; bad input is refused', async () => {
    const before = (await M('Settings').findOne({ key: 'mailAccount' }).lean()).value.passSealed;
    expect((await as('put', '/api/mail/account').send({ ...account, pass: '', from: 'Infusions Two <shop@gmail.com>' })).status).toBe(200);
    expect((await M('Settings').findOne({ key: 'mailAccount' }).lean()).value.passSealed).toBe(before);
    expect((await as('put', '/api/mail/account').send({ ...account, host: 'not a host' })).status).toBe(400);
    expect((await as('put', '/api/mail/account').send({ ...account, from: 'nobody' })).status).toBe(400);
    expect((await as('put', '/api/mail/account').send({ ...account, port: 70000 })).status).toBe(400);
  });

  it('is the superadmin\u2019s alone', async () => {
    await makeUser({ name: 'acctManager', role: 'staff', permissions: ['settings.manage'] });
    const mgr = await loginStaff(app, 'acctManager');
    expect((await as('get', '/api/mail/account', mgr)).status).toBe(403);
    expect((await as('put', '/api/mail/account', mgr).send(account)).status).toBe(403);
  });

  it('can be removed, and then nothing is set up', async () => {
    expect((await as('put', '/api/mail/account').send({ clear: true })).status).toBe(200);
    expect((await as('get', '/api/mail/status')).body.configured).toBe(false);
  });
});
