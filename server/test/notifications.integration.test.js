// Notification feed integration tests.
// The feed aggregates seven unrelated signals, so the risks are (a) a threshold
// rule firing when it shouldn't and (b) leaking a record to a role that isn't
// allowed to open it. Both are covered here.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let app, stop, superToken, cashierToken;

const daysAgo = (n) => new Date(Date.now() - n * 86400000);
const daysAhead = (n) => new Date(Date.now() + n * 86400000);

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'log', jwtSecret: 'notif-test-secret-0123456789' }));
  await makeUser({ name: 'NotifBoss', role: 'superadmin', password: 'pw' });
  await makeUser({ name: 'NotifCashier', role: 'cashier', password: 'pw' });
  await mongoose.model('User').updateMany({}, { $set: { tenantId: null } });
  superToken = await loginStaff(app, 'NotifBoss', 'pw');
  cashierToken = await loginStaff(app, 'NotifCashier', 'pw');

  const Inventory = mongoose.model('Inventory');
  await Inventory.create([
    // low but not out
    { itemCode: 'N-LOW', itemName: 'Low Item', stockQty: 3, lowStockThreshold: 10, unit: 'pcs', unitCost: 1, businessType: 'log' },
    // out of stock -> critical
    { itemCode: 'N-OUT', itemName: 'Out Item', stockQty: 0, lowStockThreshold: 5, unit: 'pcs', unitCost: 1, businessType: 'log' },
    // healthy, threshold set -> silent
    { itemCode: 'N-OK', itemName: 'Fine Item', stockQty: 99, lowStockThreshold: 10, unit: 'pcs', unitCost: 1, businessType: 'log' },
    // alerting disabled (threshold 0) even though qty is 0 -> silent
    { itemCode: 'N-OFF', itemName: 'Muted Item', stockQty: 0, lowStockThreshold: 0, unit: 'pcs', unitCost: 1, businessType: 'log' },
    // expired with stock -> critical
    { itemCode: 'N-EXP', itemName: 'Expired Item', stockQty: 5, lowStockThreshold: 0, unit: 'pcs', unitCost: 1, expiryDate: daysAgo(3), businessType: 'log' },
    // expired but depleted -> silent (nothing left to throw away)
    { itemCode: 'N-EXP0', itemName: 'Expired Empty', stockQty: 0, lowStockThreshold: 0, unit: 'pcs', unitCost: 1, expiryDate: daysAgo(3), businessType: 'log' },
    // expiring inside its warn window -> warn
    { itemCode: 'N-SOON', itemName: 'Soon Item', stockQty: 5, lowStockThreshold: 0, unit: 'pcs', unitCost: 1, expiryDate: daysAhead(3), expiryWarnDays: 7, businessType: 'log' },
    // expiring far beyond the warn window -> silent
    { itemCode: 'N-FAR', itemName: 'Far Item', stockQty: 5, lowStockThreshold: 0, unit: 'pcs', unitCost: 1, expiryDate: daysAhead(90), expiryWarnDays: 7, businessType: 'log' },
  ]);

  const Order = mongoose.model('Order');
  await Order.create([
    { orderNumber: 9001, customerName: 'Old AR', status: 'Completed', paymentMethod: 'GCash', total: 500, arSettled: false, createdAt: daysAgo(75), businessType: 'log' },
    { orderNumber: 9002, customerName: 'Mid AR', status: 'Completed', paymentMethod: 'GCash', total: 300, arSettled: false, createdAt: daysAgo(40), businessType: 'log' },
    { orderNumber: 9003, customerName: 'Fresh AR', status: 'Completed', paymentMethod: 'GCash', total: 200, arSettled: false, createdAt: daysAgo(5), businessType: 'log' },
    { orderNumber: 9004, customerName: 'Cash Sale', status: 'Completed', paymentMethod: 'Cash', total: 900, createdAt: daysAgo(75), businessType: 'log' },
  ]);
}, 120000);

afterAll(async () => { await stop(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const get = async (tok) => (await request(app).get('/api/notifications').set(auth(tok))).body;
const kinds = (body, kind) => body.items.filter(i => i.kind === kind);

describe('low stock signals', () => {
  it('flags low and out-of-stock items', async () => {
    const b = await get(superToken);
    const names = kinds(b, 'low_stock').map(i => i.title);
    expect(names.some(n => /Low Item/.test(n))).toBe(true);
    expect(names.some(n => /Out Item/.test(n))).toBe(true);
  });

  it('marks out-of-stock as critical and merely-low as warn', async () => {
    const b = await get(superToken);
    const out = kinds(b, 'low_stock').find(i => /Out Item/.test(i.title));
    const low = kinds(b, 'low_stock').find(i => /Low Item/.test(i.title));
    expect(out.severity).toBe('critical');
    expect(low.severity).toBe('warn');
  });

  it('stays silent for healthy stock and for items with alerting disabled', async () => {
    const b = await get(superToken);
    const titles = kinds(b, 'low_stock').map(i => i.title).join(' ');
    expect(titles).not.toMatch(/Fine Item/);
    expect(titles).not.toMatch(/Muted Item/);   // threshold 0 = disabled, even at qty 0
  });
});

describe('expiry signals', () => {
  it('flags expired stock as critical', async () => {
    const b = await get(superToken);
    expect(kinds(b, 'expired').some(i => /Expired Item/.test(i.title))).toBe(true);
  });

  it('ignores expired items with no stock left', async () => {
    const b = await get(superToken);
    const all = b.items.map(i => i.title).join(' ');
    expect(all).not.toMatch(/Expired Empty/);
  });

  it('warns inside the item\'s warn window but not outside it', async () => {
    const b = await get(superToken);
    expect(kinds(b, 'expiring').some(i => /Soon Item/.test(i.title))).toBe(true);
    expect(b.items.map(i => i.title).join(' ')).not.toMatch(/Far Item/);
  });
});

describe('quantities are reported in DISPLAY units, not base units', () => {
  // Inventory stores base units (g/ml). Reporting "200 left" for 200 g of an
  // item the user thinks of in kg reads as a completely different quantity.
  it('converts a low-stock quantity out of base units', async () => {
    const Inventory = mongoose.model('Inventory');
    await Inventory.create({
      itemCode: 'N-UNIT', itemName: 'Unit Beans', stockQty: 200, lowStockThreshold: 5000,
      unit: 'g', displayUnit: 'kg', unitMultiplier: 1000, packSize: 1, unitCost: 1, businessType: 'log',
    });
    const b = await get(superToken);
    const row = b.items.find(i => /Unit Beans/.test(i.title));
    expect(row).toBeTruthy();
    // 200 g / (packSize 1 × multiplier 1000) = 0.2 pcs — NOT the raw 200.
    expect(row.detail).toMatch(/0\.2 pcs left/);
    expect(row.detail).not.toMatch(/\b200 left\b/);
    // the threshold is converted too, so both numbers are in the same scale
    expect(row.detail).toMatch(/alert at 5 pcs/);
  });

  it('converts the expiry quantity too', async () => {
    const Inventory = mongoose.model('Inventory');
    await Inventory.create({
      itemCode: 'N-UNIT2', itemName: 'Unit Syrup', stockQty: 3000, lowStockThreshold: 0,
      unit: 'ml', displayUnit: 'L', unitMultiplier: 1000, packSize: 1, unitCost: 1,
      expiryDate: daysAgo(4), businessType: 'log',
    });
    const b = await get(superToken);
    const row = b.items.find(i => /Unit Syrup/.test(i.title));
    expect(row.detail).toMatch(/3 pcs in stock/);
    expect(row.detail).not.toMatch(/3000/);
  });
});

describe('A/R ageing', () => {
  it('flags only non-cash sales older than 30 days', async () => {
    const b = await get(superToken);
    const ar = kinds(b, 'ar_overdue');
    const titles = ar.map(i => i.title).join(' ');
    expect(titles).toMatch(/9001/);
    expect(titles).toMatch(/9002/);
    expect(titles).not.toMatch(/9003/);   // only 5 days old
    expect(titles).not.toMatch(/9004/);   // cash never becomes A/R
  });

  it('escalates past 60 days to critical', async () => {
    const b = await get(superToken);
    const ar = kinds(b, 'ar_overdue');
    expect(ar.find(i => /9001/.test(i.title)).severity).toBe('critical');  // 75d
    expect(ar.find(i => /9002/.test(i.title)).severity).toBe('warn');      // 40d
  });
});

describe('payload shape', () => {
  it('gives every item navigation coordinates so the UI can jump to it', async () => {
    const b = await get(superToken);
    expect(b.items.length).toBeGreaterThan(0);
    for (const i of b.items) {
      expect(i.tab).toBeTruthy();
      expect(i.id).toBeTruthy();
      expect(['critical', 'warn', 'info']).toContain(i.severity);
    }
  });

  it('sorts critical items first', async () => {
    const b = await get(superToken);
    const rank = { critical: 0, warn: 1, info: 2 };
    const seq = b.items.map(i => rank[i.severity]);
    expect(seq).toEqual([...seq].sort((a, z) => a - z));
  });

  it('reports counts consistent with the items array', async () => {
    const b = await get(superToken);
    expect(b.count).toBe(b.items.length);
    expect(b.criticalCount).toBe(b.items.filter(i => i.severity === 'critical').length);
  });
});

describe('permission scoping', () => {
  it('does not leak A/R rows to a cashier who cannot view accounting', async () => {
    const b = await get(cashierToken);
    expect(kinds(b, 'ar_overdue')).toHaveLength(0);
  });

  it('still requires authentication', async () => {
    const res = await request(app).get('/api/notifications');
    expect(res.status).toBe(401);
  });
});
