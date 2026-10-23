// Owner insights: what changed since the last period, which products earn,
// and the 30/60/90-day cash outlook. All read-only over what is recorded.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok, staffTok;
const as = (m, p, t = tok) => request(app)[m](p).set('Authorization', `Bearer ${t}`);
const M = (n) => mongoose.model(n);
const daysAgo = (n) => new Date(Date.now() - n * 86400000);
const inDays = (n) => new Date(Date.now() + n * 86400000);
let flour, sugar;

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'insightOwner', role: 'superadmin', password: 'ownerpass1' });
  await makeUser({ name: 'insightCrew', role: 'staff', password: 'crewpass12', permissions: [] });
  tok = await loginStaff(app, 'insightOwner', 'ownerpass1');
  staffTok = await loginStaff(app, 'insightCrew', 'crewpass12');

  // Two products with recipes, costed at today's ingredient prices.
  [flour, sugar] = await M('Inventory').create([
    { businessType: 'log', itemCode: 'FLR', itemName: 'Flour', unit: 'kg', stockQty: 100, unitCost: 50 },
    { businessType: 'log', itemCode: 'SGR', itemName: 'Sugar', unit: 'kg', stockQty: 100, unitCost: 10 },
  ]);
  const bread = await M('Product').create({ businessType: 'log', name: 'Bread', category: 'Bakery', basePrice: 100, baseRecipe: [{ invId: String(flour._id), qty: 1 }] });
  const candy = await M('Product').create({ businessType: 'log', name: 'Candy', category: 'Sweets', basePrice: 40, baseRecipe: [{ invId: String(sugar._id), qty: 0.5 }] });
  const order = (when, items) => M('Order').create({
    businessType: 'log', orderNumber: `INS-${Math.random().toString(36).slice(2, 8)}`, table: 'Pickup', status: 'Completed',
    items, total: items.reduce((s, i) => s + i.price * i.quantity, 0), createdAt: when,
  });
  // Previous 30 days: 10 bread. This 30 days: 6 bread and 20 candy.
  await order(daysAgo(40), [{ name: 'Bread', productId: String(bread._id), price: 100, quantity: 10 }]);
  await order(daysAgo(5), [{ name: 'Bread', productId: String(bread._id), price: 100, quantity: 6 }]);
  await order(daysAgo(3), [{ name: 'Candy', productId: String(candy._id), price: 40, quantity: 20 }]);

  // Flour cost 40 a kg last period, 50 now (+25%); sugar unchanged.
  await M('StockCard').create([
    { inventoryId: flour._id, itemName: 'Flour', type: 'Restock', qtyChange: 20, unitCost: 40, balanceAfter: 20, date: daysAgo(45) },
    { inventoryId: flour._id, itemName: 'Flour', type: 'Restock', qtyChange: 20, unitCost: 50, balanceAfter: 40, date: daysAgo(10) },
    { inventoryId: sugar._id, itemName: 'Sugar', type: 'Restock', qtyChange: 10, unitCost: 10, balanceAfter: 10, date: daysAgo(10) },
  ]);
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('permissions', () => {
  it('keeps every insight behind reports.view', async () => {
    for (const p of ['/api/insights/what-changed', '/api/insights/product-profitability', '/api/insights/cash-outlook']) {
      expect((await request(app).get(p)).status).toBe(401);
      expect((await as('get', p, staffTok)).status).toBe(403);
    }
  });
});

describe('what changed', () => {
  it('compares the window to the one before and explains the cost moves', async () => {
    const res = await as('get', '/api/insights/what-changed?days=30');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const b = res.body;
    expect(b.days).toBe(30);
    expect(b.previous.end < b.current.start).toBe(true);
    expect(b.current.orders).toBe(2);
    expect(b.previous.orders).toBe(1);
    const flourMove = b.costMovers.find(c => c.itemName === 'Flour');
    expect(flourMove).toMatchObject({ unitCost: 50, prevUnitCost: 40, changePct: 25 });
    expect(b.costMovers.find(c => c.itemName === 'Sugar')).toBeUndefined();
    expect(b.insights.some(i => i.kind === 'cost' && /Flour now costs 25% more/.test(i.text))).toBe(true);
    const candy = b.productMovers.find(p => p.name === 'Candy');
    expect(candy).toMatchObject({ revenue: 800, prevRevenue: 0, change: 800 });
    expect(b.productMovers.find(p => p.name === 'Bread')).toMatchObject({ revenue: 600, prevRevenue: 1000, change: -400 });
    expect(b.insights.some(i => i.kind === 'product' && /Bread sold 400\.00 less/.test(i.text))).toBe(true);
  });

  it('reads the same revenue and cost of sales as the P&L', async () => {
    const b = (await as('get', '/api/insights/what-changed?days=30')).body;
    const pnl = (await as('get', `/api/reports/pnl?start=${b.current.start}&end=${b.current.end}`)).body;
    expect(b.current.cogs).toBeCloseTo(pnl.totals?.cogs ?? pnl.cogs ?? 0, 2);
  });
});

describe('product profitability', () => {
  it('ranks products by profit with best and worst margins', async () => {
    const res = await as('get', '/api/insights/product-profitability?days=30');
    expect(res.status).toBe(200);
    const b = res.body;
    const byName = Object.fromEntries(b.items.map(i => [i.name, i]));
    // Bread: 6 x 100 revenue, 6 x 1kg flour at 50. Candy: 20 x 40, 20 x 0.5kg sugar at 10.
    expect(byName.Bread).toMatchObject({ qty: 6, revenue: 600, cogs: 300, profit: 300, margin: 50 });
    expect(byName.Candy).toMatchObject({ qty: 20, revenue: 800, cogs: 100, profit: 700, margin: 87.5 });
    expect(b.best[0].name).toBe('Candy');
    expect(b.worst[0].name).toBe('Bread');
    expect(b.totals).toMatchObject({ revenue: 1400, cogs: 400, profit: 1000 });
    expect(b.lossMakers).toEqual([]);
  });

  it('honours an explicit date range', async () => {
    const start = new Date(daysAgo(50)).toISOString().slice(0, 10), end = new Date(daysAgo(35)).toISOString().slice(0, 10);
    const b = (await as('get', `/api/insights/product-profitability?start=${start}&end=${end}`)).body;
    expect(b.items.map(i => i.name)).toEqual(['Bread']);
    expect(b.items[0].revenue).toBe(1000);
  });
});

describe('cash outlook', () => {
  it('puts bills, collections and payroll into 30/60/90 days', async () => {
    const client = (await as('post', '/api/client-accounts').send({ username: 'outco', password: 'secret123', name: 'Outlook Co', paymentMethod: 'On Account' })).body.client;
    const owe = (total, over) => M('Order').create({
      businessType: 'log', orderNumber: `AR-${Math.random().toString(36).slice(2, 8)}`, table: 'Pickup', status: 'Completed',
      paymentMethod: 'On Account', clientAccountId: client._id, customerName: 'Outlook Co',
      items: [{ name: 'Open Item', price: total, quantity: 1 }], total, ...over,
    });
    await owe(1000, { arDueDate: inDays(45) });                              // in at day 45, in full
    await owe(2000, { arDueDate: daysAgo(10), createdAt: daysAgo(100) });   // 90+ days old: 30% now

    const bill = (over) => M('Bill').create({ businessType: 'log', billNumber: `BILL-OL-${Math.random().toString(36).slice(2, 7)}`, supplierName: 'Mill', supplierId: new mongoose.Types.ObjectId(), source: 'Manual', description: 'x', amount: 100, status: 'Approved', ...over });
    await bill({ amount: 700, dueDate: inDays(10) });
    await bill({ amount: 900, paidAmount: 400, status: 'Partially Paid', dueDate: inDays(70) });
    await bill({ amount: 300, status: 'Pending', dueDate: inDays(5) });           // not approved: shown, not counted
    await bill({ amount: 5000, status: 'Paid', dueDate: inDays(2) });             // settled

    // Payroll every 15 days, last paid 5 days ago at 1,000 net.
    const run = (payDate, net, status = 'Paid') => M('PayrollRun').create({ businessType: 'log', periodStart: daysAgo(30), periodEnd: payDate, payDate, status, totals: { net } });
    await run(daysAgo(35), 1000); await run(daysAgo(20), 1000); await run(daysAgo(5), 1000);

    const res = await as('get', '/api/insights/cash-outlook');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const b = res.body;
    expect(b.horizons.map(h => h.days)).toEqual([30, 60, 90]);
    const [d30, d60, d90] = b.horizons;
    expect(b.payroll).toMatchObject({ cadenceDays: 15, averageNet: 1000 });
    // Payroll on days 10, 25 | 40, 55 | 70, 85.
    expect([d30.out.payroll, d60.out.payroll, d90.out.payroll]).toEqual([2000, 4000, 6000]);
    expect([d30.out.bills, d60.out.bills, d90.out.bills]).toEqual([700, 700, 1200]);
    expect([d30.in, d60.in, d90.in]).toEqual([600, 1600, 1600]);
    expect(b.receivables).toMatchObject({ total: 3000, notExpected: 1400 });
    expect(b.awaitingApproval).toBe(300);
    for (const h of b.horizons) expect(h.endingBalance).toBeCloseTo(b.cashNow + h.in - h.out.total, 2);
    expect(b.lowest.balance).toBeLessThanOrEqual(b.cashNow);
    expect(b.shortfall).toBe(b.lowest.balance < 0);
    expect(b.upcoming.length).toBeGreaterThan(0);
  });
});
