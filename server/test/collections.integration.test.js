// AR collection reminders - overdue worklist, follow-up-due list, and the
// contact log itself. Drives the real Express app over HTTP against an
// in-memory replica set, same harness as critical-paths.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, superTok, staffTok;
const auth = (method, path, token) => request(app)[method](path).set('Authorization', `Bearer ${token}`);
const daysAgo = (n) => new Date(Date.now() - n * 86400000);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'collSuper', role: 'superadmin' });
  await makeUser({ name: 'collStaff', role: 'staff' });
  superTok = await loginStaff(app, 'collSuper');
  staffTok = await loginStaff(app, 'collStaff');

  const Order = mongoose.model('Order');
  await Order.create([
    { orderNumber: 'COLL-1', customerName: 'Overdue Client', status: 'Completed', paymentMethod: 'GCash', total: 800, subtotal: 800, arSettled: false, createdAt: daysAgo(75), businessType: 'log' },
    { orderNumber: 'COLL-2', customerName: 'Fresh Client', status: 'Completed', paymentMethod: 'GCash', total: 200, subtotal: 200, arSettled: false, createdAt: daysAgo(5), businessType: 'log' },
    { orderNumber: 'COLL-3', customerName: 'Cash Client', status: 'Completed', paymentMethod: 'Cash', total: 900, subtotal: 900, createdAt: daysAgo(75), businessType: 'log' },
  ]);
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('AR collection reminders', () => {
  it('overdue worklist includes the 75-day client but not the fresh or cash one', async () => {
    const res = await auth('get', '/api/collections/overdue', superTok);
    expect(res.status).toBe(200);
    const names = res.body.clients.map((c) => c.client);
    expect(names).toContain('Overdue Client');
    expect(names).not.toContain('Fresh Client');
    expect(names).not.toContain('Cash Client');
    const overdueRow = res.body.clients.find((c) => c.client === 'Overdue Client');
    expect(overdueRow.lastReminder).toBeNull();
    expect(overdueRow.d61_90).toBeCloseTo(800, 2);
  });

  it('is gated behind accounting.view (plain staff cannot read the overdue list)', async () => {
    const res = await auth('get', '/api/collections/overdue', staffTok);
    expect(res.status).toBe(403);
  });

  it('the never-contacted overdue client shows up in the due-today worklist', async () => {
    const res = await auth('get', '/api/collections/due', superTok);
    expect(res.status).toBe(200);
    const row = res.body.clients.find((c) => c.client === 'Overdue Client');
    expect(row).toBeTruthy();
    expect(row.neverContacted).toBe(true);
  });

  it('rejects logging a reminder with an invalid method', async () => {
    const res = await auth('post', '/api/collections/reminders', staffTok).send({
      client: 'Overdue Client', method: 'Carrier Pigeon',
    });
    expect(res.status).toBe(400);
  });

  it('any staff with orders.view can log a reminder (broader than accounting.view)', async () => {
    const res = await auth('post', '/api/collections/reminders', staffTok).send({
      client: 'Overdue Client', method: 'Call', note: 'Promised to pay next week',
      nextFollowUpDate: new Date(Date.now() + 7 * 86400000).toISOString(),
    });
    expect(res.status).toBe(200);
    expect(res.body.reminder.amountOwedAtTime).toBeCloseTo(800, 2);
    expect(res.body.reminder.loggedBy).toBe('collStaff');
  });

  it('after logging a future follow-up, the client drops off the due-today list', async () => {
    const res = await auth('get', '/api/collections/due', superTok);
    const row = res.body.clients.find((c) => c.client === 'Overdue Client');
    expect(row).toBeUndefined();
  });

  it('the overdue list now shows the logged reminder', async () => {
    const res = await auth('get', '/api/collections/overdue', superTok);
    const row = res.body.clients.find((c) => c.client === 'Overdue Client');
    expect(row.lastReminder).toBeTruthy();
    expect(row.lastReminder.method).toBe('Call');
  });

  it('reminder history for the client returns the logged entry', async () => {
    const res = await auth('get', '/api/collections/reminders?client=Overdue Client', superTok);
    expect(res.status).toBe(200);
    expect(res.body.reminders.length).toBe(1);
    expect(res.body.reminders[0].note).toBe('Promised to pay next week');
  });

  it('logging a reminder with a PAST follow-up date puts the client right back on the due-today list', async () => {
    await auth('post', '/api/collections/reminders', staffTok).send({
      client: 'Overdue Client', method: 'SMS', nextFollowUpDate: new Date(Date.now() - 86400000).toISOString(),
    });
    const res = await auth('get', '/api/collections/due', superTok);
    const row = res.body.clients.find((c) => c.client === 'Overdue Client');
    expect(row).toBeTruthy();
    expect(row.neverContacted).toBe(false);
  });
});
