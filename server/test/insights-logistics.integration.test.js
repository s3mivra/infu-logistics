// Sales targets and the delivery sheet (features/insights.js).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok, staffTok;
const as = (m, p, t = tok) => request(app)[m](p).set('Authorization', `Bearer ${t}`);
const M = (n) => mongoose.model(n);
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const order = (over) => M('Order').create({
  businessType: 'log', orderNumber: `IL-${Math.random().toString(36).slice(2, 8)}`, table: 'Pickup', items: [],
  subtotal: 100, total: 100, status: 'Completed', paymentMethod: 'Cash', cashier: 'Till Person', ...over,
});

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'logiOwner', role: 'superadmin' });
  await makeUser({ name: 'logiStaff', role: 'staff', permissions: ['reports.view'] });
  tok = await loginStaff(app, 'logiOwner');
  staffTok = await loginStaff(app, 'logiStaff');
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('sales targets', () => {
  it('counts a sale for its salesperson, or for whoever rang it up when it names none', async () => {
    await order({ total: 6000, salesperson: 'Rep Ana' });
    await order({ total: 4000, salesperson: 'Rep Ana' });
    await order({ total: 1500 });                                  // no salesperson: the cashier's
    await order({ total: 9999, isComplimentary: true, salesperson: 'Rep Ana' });   // not a sale

    expect((await as('put', '/api/reports/sales-targets').send({ name: 'Rep Ana', target: 20000 })).status).toBe(200);
    const res = await as('get', '/api/reports/sales-targets');
    expect(res.status).toBe(200);
    const ana = res.body.sellers.find(s => s.name === 'Rep Ana');
    expect(ana).toMatchObject({ sales: 10000, orders: 2, target: 20000, percent: 50, remaining: 10000 });
    expect(typeof ana.onPace).toBe('boolean');
    const till = res.body.sellers.find(s => s.name === 'Till Person');
    expect(till).toMatchObject({ sales: 1500, target: 0, percent: null, onPace: null });
    expect(res.body.totals).toMatchObject({ sales: 11500, target: 20000 });
  });

  it('a target of zero removes it, and an earlier month is judged on the whole month', async () => {
    await as('put', '/api/reports/sales-targets').send({ name: 'Rep Ben', target: 500 });
    await as('put', '/api/reports/sales-targets').send({ name: 'Rep Ben', target: 0 });
    const now = (await as('get', '/api/reports/sales-targets')).body;
    expect(now.sellers.find(s => s.name === 'Rep Ben')).toBeUndefined();

    const past = (await as('get', '/api/reports/sales-targets?month=2020-02')).body;
    expect(past).toMatchObject({ month: '2020-02', daysInMonth: 29, daysElapsed: 29, isCurrent: false });
    expect(past.sellers.find(s => s.name === 'Rep Ana')).toMatchObject({ sales: 0, target: 20000, percent: 0, onPace: false, perDayNeeded: null });
  });

  it('only someone who manages users can set one', async () => {
    expect((await as('put', '/api/reports/sales-targets', staffTok).send({ name: 'Rep Ana', target: 1 })).status).toBe(403);
    expect((await as('put', '/api/reports/sales-targets').send({ name: '', target: 5 })).status).toBe(400);
    expect((await as('put', '/api/reports/sales-targets').send({ name: 'Rep Ana', target: -5 })).status).toBe(400);
  });
});

describe('the delivery sheet', () => {
  it('lists the deliveries of the day by address, with what to collect at the door', async () => {
    const today = new Date();
    const items = [{ name: 'Box of Cups', quantity: 3, price: 100 }, { name: 'Lids', quantity: 2, price: 50 }];
    await order({ orderNumber: 'DS-B', table: 'Manual Delivery', paymentMethod: 'Manual Delivery', status: 'Preparing', total: 400, items, deliveryAddress: 'Zone 2, Mabini St', customerName: 'Bee Store', orderNotes: 'gate 3' });
    await order({ orderNumber: 'DS-A', table: 'Lalamove', paymentMethod: 'Credit', status: 'Preparing', total: 900, items, deliveryAddress: 'Aurora Blvd', customerName: 'Aye Trading' });
    await order({ orderNumber: 'DS-DONE', table: 'Manual Delivery', paymentMethod: 'Manual Delivery', status: 'Completed', dispatchStatus: 'Delivered', total: 250, deliveryAddress: 'Zone 1' });
    await order({ orderNumber: 'DS-PICKUP', table: 'Pickup', total: 100 });                                   // not a delivery
    await order({ orderNumber: 'DS-CANCEL', table: 'Manual Delivery', status: 'Cancelled', total: 100 });     // cancelled
    await order({ orderNumber: 'DS-OLD', table: 'Manual Delivery', paymentMethod: 'Manual Delivery', status: 'Preparing', total: 300, deliveryAddress: '', createdAt: new Date(Date.now() - 3 * 86400000) });

    const res = await as('get', `/api/reports/delivery-sheet?date=${ymd(today)}`);
    expect(res.status).toBe(200);
    const sheet = res.body;
    // Still to go first (by address, no address last), delivered at the end.
    expect(sheet.stops.map(s => s.orderNumber)).toEqual(['DS-A', 'DS-B', 'DS-OLD', 'DS-DONE']);
    expect(sheet.stops.find(s => s.orderNumber === 'DS-B')).toMatchObject({ collect: 400, pieces: 5, note: 'gate 3', items: ['3 x Box of Cups', '2 x Lids'] });
    expect(sheet.stops.find(s => s.orderNumber === 'DS-A').collect).toBe(0);            // on account: nothing at the door
    expect(sheet.stops.find(s => s.orderNumber === 'DS-OLD').carriedOver).toBe(true);
    expect(sheet.stops.find(s => s.orderNumber === 'DS-DONE')).toMatchObject({ done: true, collect: 0 });
    expect(sheet.totals).toMatchObject({ stops: 4, toDeliver: 3, delivered: 1, toCollect: 700, noAddress: 1 });
  });
});
