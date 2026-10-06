// The reorder forecast on the analytics dashboard: every stock item that sells,
// how long it lasts at the pace it sells, what is already on order, and how
// much more to buy.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok, fast, idle;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'fcBoss', role: 'superadmin' });
  tok = await loginStaff(app, 'fcBoss');
  const Inventory = mongoose.model('Inventory');
  const Product = mongoose.model('Product');
  await mongoose.model('Category').create({ name: 'FcCat', department: 'Kitchen' });
  fast = await Inventory.create({ itemName: 'Fast Syrup', itemCode: 'FC-1', stockQty: 40, unit: 'pcs', unitCost: 10 });
  idle = await Inventory.create({ itemName: 'Idle Syrup', itemCode: 'FC-2', stockQty: 40, unit: 'pcs', unitCost: 10 });
  const prod = await Product.create({ name: 'Fast Syrup', productCode: 'FC-1', category: 'FcCat', basePrice: 100, baseRecipe: [] });
  // 20 sold today, the first day of trading: 20 a day.
  const placed = await auth('post', '/api/orders').send({
    table: 'Takeout', paymentMethod: 'Cash', customerName: 'Buyer',
    items: [{ productId: String(prod._id), name: 'Fast Syrup', price: 100, quantity: 20 }],
  });
  expect(placed.status, JSON.stringify(placed.body)).toBeLessThan(300);
  const done = await auth('put', `/api/orders/${placed.body.order._id}`).send({ status: 'Completed' });
  expect(done.status, JSON.stringify(done.body)).toBe(200);
}, 120000);
afterAll(async () => { await ctx.stop(); });

const forecast = async () => {
  const r = await auth('get', '/api/analytics/dashboard');
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
};

describe('reorder forecast', () => {
  it('lists what sells, at the pace of the days actually traded, and leaves out what does not', async () => {
    const d = await forecast();
    const row = d.reorderForecast.find(x => x.itemName === 'Fast Syrup');
    expect(row, JSON.stringify(d.reorderForecast)).toBeTruthy();
    expect(row.stockQty).toBe(20);
    expect(row.dailyUse).toBeCloseTo(20, 5);          // one day of history, not 20 / 30
    expect(row.daysLeft).toBe(1);
    expect(row.status).toBe('now');
    // 14 days + 7 delivery + 3 spare = 24 days x 20, less the 20 on hand.
    expect(row.buy14).toBe(460);
    expect(d.reorderForecast.find(x => x.itemName === 'Idle Syrup')).toBeUndefined();
    expect(d.forecastSettings).toMatchObject({ leadTimeDays: 7, safetyDays: 3, historyDays: 1 });
  });

  it('counts what is already on an open purchase order', async () => {
    await mongoose.model('PurchaseOrder').create({
      poNumber: 'PO-FC-1', supplier: 'Any', status: 'Ordered',
      lines: [{ invId: fast._id, itemName: 'Fast Syrup', orderedQty: 300, receivedQty: 0, unitCost: 10 }],
    });
    const row = (await forecast()).reorderForecast.find(x => x.itemName === 'Fast Syrup');
    expect(row.onOrder).toBe(300);
    expect(row.buy14).toBe(160);
    expect(row.status).toBe('soon');                  // 320 covered at 20 a day = 16 days: past delivery + spare, inside the week after
  });
});

describe('suggested purchase order', () => {
  it('suggests what is selling out even with no low-stock threshold, less what is on order', async () => {
    // Fast Syrup: 20 on hand, 300 on order, 20 a day. 14 days + 10 to arrive = 480 needed.
    const r = await auth('get', '/api/reports/purchase-order?days=14');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.lines.find(l => l.itemName === 'Fast Syrup')).toBeUndefined();   // 320 covered: not selling out yet
    await mongoose.model('PurchaseOrder').updateOne({ poNumber: 'PO-FC-1' }, { $set: { status: 'Cancelled' } });
    const again = await auth('get', '/api/reports/purchase-order?days=14');
    const line = again.body.lines.find(l => l.itemName === 'Fast Syrup');
    expect(line, JSON.stringify(again.body.lines)).toBeTruthy();
    expect(line.suggestedOrder).toBe(460);
    expect(again.body.lines.find(l => l.itemName === 'Idle Syrup')).toBeUndefined();
  });
});
