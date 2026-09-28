// The 2026-09 pre-production audit's P0/P1 fixes, each pinned by the behaviour
// that was wrong: a self-service order setting its own discount, a users.manage
// delegate taking over a stronger account, a revoked token still ringing sales,
// a percentage-tax accrual posted twice, an offline sale landing on the wrong
// day, and products that auto-removed on a stockout never coming back.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, makeClient, loginStaff, loginClient, trialBalance } from './helpers/harness.js';

let ctx, app, prod, inv;
const tok = {};
let clientTok;
const auth = (m, p, t) => request(app)[m](p).set('Authorization', `Bearer ${t}`);
const line = (qty = 1) => ({ productId: String(prod._id), name: 'Latte', price: 1, quantity: qty });
const waitFor = async (fn, ms = 8000) => {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
};

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'afSuper', role: 'superadmin' });
  await makeUser({ name: 'afStaff', role: 'staff' });
  // No pos.use: the start-up migration grants orders.comp to anyone holding
  // pos.use, and under load it can run after this user is created.
  await makeUser({ name: 'afNoComp', role: 'staff', permissions: ['orders.view', 'orders.manage'] });
  await makeUser({ name: 'afAdmin', role: 'admin' });
  // A narrow delegate: may run the roster, holds none of the books.
  await makeUser({ name: 'afDelegate', role: 'staff', permissions: ['users.manage', 'pos.use', 'orders.view'] });
  await makeUser({ name: 'afBarista', role: 'staff', permissions: ['pos.use', 'orders.view'] });
  await makeClient({ username: 'afClient' });
  for (const n of ['afSuper', 'afStaff', 'afNoComp', 'afAdmin', 'afDelegate', 'afBarista']) tok[n] = await loginStaff(app, n);
  clientTok = await loginClient(app, 'afClient');

  const Category = mongoose.model('Category');
  await Category.create({ name: 'AFCat', department: 'Bar' });
  inv = await mongoose.model('Inventory').create({ itemName: 'Milk', stockQty: 10, unit: 'ml', unitCost: 0.1, lowStockThreshold: 0 });
  prod = await mongoose.model('Product').create({
    name: 'Latte', category: 'AFCat', basePrice: 150,
    baseRecipe: [{ invId: String(inv._id), name: 'Milk', qty: 10, cost: 1, unit: 'ml' }],
  });
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('P0: order-level discounts are the cashier\'s, never the buyer\'s', () => {
  const tricks = { discountPercent: 100, discountFlat: 500, isComplimentary: true, isVatExempt: true };

  it('a client-portal order cannot discount, comp or VAT-exempt itself', async () => {
    const res = await auth('post', '/api/orders', clientTok).send({ items: [line(1)], table: 'Takeout', ...tricks });
    expect(res.status).toBe(200);
    const o = res.body.order;
    expect(o.total).toBe(150);
    expect(o.isComplimentary).toBe(false);
    expect(o.discountPercent).toBe(0);
    expect(o.isVatExempt).toBe(false);
  });

  it('a QR (anonymous) order cannot either', async () => {
    const s = await auth('post', '/api/sessions/generate', tok.afSuper).send({ table: 'T9' });
    expect(s.status).toBe(200);
    const res = await request(app).post('/api/orders').send({ items: [line(1)], table: 'T9', sessionId: s.body.sessionId, ...tricks });
    expect(res.status).toBe(200);
    expect(res.body.order.total).toBe(150);
    expect(res.body.order.isComplimentary).toBe(false);
  });

  it('staff without orders.comp cannot create a complimentary order', async () => {
    const res = await auth('post', '/api/orders', tok.afNoComp).send({ items: [line(1)], table: 'Takeout', isComplimentary: true });
    expect(res.status).toBe(403);
  });

  it('a cashier can still discount (clamped to 0-100)', async () => {
    const res = await auth('post', '/api/orders', tok.afStaff).send({ items: [line(1)], table: 'Takeout', discountPercent: 250 });
    expect(res.status).toBe(200);
    expect(res.body.order.discountPercent).toBe(100);
  });

  it('a delivery fee of Infinity or with 3 decimals is bounded and rounded', async () => {
    const res = await auth('post', '/api/orders', tok.afStaff).send({ items: [line(1)], table: 'Takeout', deliveryFee: 12.345 });
    expect(res.body.order.deliveryFee).toBe(12.35);
    const inf = await auth('post', '/api/orders', tok.afStaff).send({ items: [line(1)], table: 'Takeout', deliveryFee: 'Infinity' });
    expect(inf.status).toBe(200);
    expect(Number.isFinite(inf.body.order.total)).toBe(true);
  });
});

describe('P1: a users.manage delegate cannot take over a stronger account', () => {
  it('cannot reset the password of an Admin holding permissions they lack', async () => {
    const admin = await mongoose.model('User').findOne({ name: 'afAdmin' }).lean();
    const res = await auth('put', `/api/users/${admin._id}`, tok.afDelegate).send({ name: 'afAdmin', password: 'taken-over' });
    expect(res.status).toBe(403);
    const login = await request(app).post('/api/users/login').send({ name: 'afAdmin', password: 'taken-over' });
    expect(login.body.token).toBeFalsy();
  });

  it('cannot delete that Admin either', async () => {
    const admin = await mongoose.model('User').findOne({ name: 'afAdmin' }).lean();
    const res = await auth('delete', `/api/users/${admin._id}`, tok.afDelegate);
    expect(res.status).toBe(403);
  });

  it('can still manage an account within their own permissions', async () => {
    const b = await mongoose.model('User').findOne({ name: 'afBarista' }).lean();
    const res = await auth('put', `/api/users/${b._id}`, tok.afDelegate).send({ name: 'afBarista', password: 'new-pw-1' });
    expect(res.status).toBe(200);
  });
});

describe('P1: a revoked staff token cannot place orders', () => {
  it('is refused on POST /api/orders once the user\'s sessions are revoked', async () => {
    await makeUser({ name: 'afLeaver', role: 'staff' });
    const t = await loginStaff(app, 'afLeaver');
    expect((await auth('post', '/api/orders', t).send({ items: [line(1)], table: 'Takeout' })).status).toBe(200);
    const u = await mongoose.model('User').findOne({ name: 'afLeaver' }).lean();
    const del = await auth('delete', `/api/users/${u._id}`, tok.afSuper);
    expect(del.status).toBe(200);
    const res = await auth('post', '/api/orders', t).send({ items: [line(1)], table: 'Takeout' });
    expect(res.status).toBe(401);
  });
});

describe('P1: offline replay keeps the day the sale was taken', () => {
  it('honours placedAt on a staff replay within 72h', async () => {
    const at = new Date(Date.now() - 26 * 3600_000); // yesterday
    const res = await auth('post', '/api/orders', tok.afStaff).set('Idempotency-Key', 'af-offline-1')
      .send({ items: [line(1)], table: 'Takeout', placedAt: at.toISOString() });
    expect(res.status).toBe(200);
    expect(Math.abs(new Date(res.body.order.createdAt).getTime() - at.getTime())).toBeLessThan(1000);
  });

  it('ignores placedAt that is too old, in the future, or without an idempotency key', async () => {
    for (const [key, at] of [['af-offline-2', Date.now() - 5 * 86400_000], ['af-offline-3', Date.now() + 3600_000], [null, Date.now() - 3600_000]]) {
      let r = auth('post', '/api/orders', tok.afStaff);
      if (key) r = r.set('Idempotency-Key', key);
      const res = await r.send({ items: [line(1)], table: 'Takeout', placedAt: new Date(at).toISOString() });
      expect(Date.now() - new Date(res.body.order.createdAt).getTime()).toBeLessThan(60_000);
    }
  });
});

describe('P1: journal entries balance exactly, to the centavo', () => {
  it('refuses an entry one centavo out', async () => {
    const JE = mongoose.model('JournalEntry');
    await expect(JE.create({ reference: 'AF-UNBAL', lines: [
      { accountCode: '111000', debit: 100, credit: 0 }, { accountCode: '410000', debit: 0, credit: 99.99 },
    ] })).rejects.toThrow(/UNBALANCED/);
  });
  it('refuses a non-finite amount instead of storing zero', async () => {
    const JE = mongoose.model('JournalEntry');
    await expect(JE.create({ reference: 'AF-INF', lines: [
      { accountCode: '111000', debit: Infinity, credit: 0 }, { accountCode: '410000', debit: 0, credit: Infinity },
    ] })).rejects.toThrow(/not a valid amount/);
  });
  it('stores each line to the centavo', async () => {
    const JE = mongoose.model('JournalEntry');
    const je = await JE.create({ reference: 'AF-ROUND', lines: [
      { accountCode: '111000', debit: 1.005, credit: 0 }, { accountCode: '410000', debit: 0, credit: 1.005 },
    ] });
    expect(je.lines[0].debit).toBe(1.01);
    expect(je.totalDebit).toBe(1.01);
    await mongoose.model('JournalEntry').collection.deleteOne({ _id: je._id }); // fixture cleanup
  });
});

describe('P1: percentage-tax accrual cannot double-post', () => {
  it('two simultaneous accruals for the same month post once', async () => {
    const Order = mongoose.model('Order');
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 2); d.setHours(12);
    await Order.create({ orderNumber: 'AF-PCT-1', status: 'Completed', total: 1000, subtotal: 1000, vatRate: 0, businessType: 'fb', createdAt: d, items: [] });
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const [a, b] = await Promise.all([
      auth('post', '/api/reports/percentage-tax/accrue', tok.afSuper).send({ month }),
      auth('post', '/api/reports/percentage-tax/accrue', tok.afSuper).send({ month }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const JE = mongoose.model('JournalEntry');
    const rows = await JE.aggregate([
      { $match: { reference: { $regex: `^PCT-${month}` } } }, { $unwind: '$lines' },
      { $match: { 'lines.accountCode': '230400' } },
      { $group: { _id: null, cr: { $sum: '$lines.credit' }, dr: { $sum: '$lines.debit' } } },
    ]);
    expect(Math.round(((rows[0]?.cr || 0) - (rows[0]?.dr || 0)) * 100) / 100).toBe(30);
    const tb = await trialBalance();
    expect(Math.abs(tb.debits - tb.credits)).toBeLessThan(0.005);
  });
});

describe('Backdate sale: per-item discount', () => {
  it('takes each line\'s own percent first, then the order-wide one', async () => {
    const date = new Date(Date.now() - 3 * 86400_000).toISOString().slice(0, 10);
    const res = await auth('post', '/api/admin/backdate-sale', tok.afSuper).send({
      date, discountPercent: 10,
      items: [{ name: 'Latte', price: 180, quantity: 1, discountPercent: 50 }, { name: 'Hojicha', price: 140, quantity: 1 }],
    });
    expect(res.status).toBe(200);
    // lines: 90 + 140 = 230; then 10% off = 207.
    expect(res.body.order.total).toBe(207);
    expect(res.body.order.discount).toBe(113);
    expect(res.body.order.items[0].discountPercent).toBe(50);
    const je = await mongoose.model('JournalEntry').findOne({ reference: res.body.journalReference }).lean();
    expect(je.totalDebit).toBe(je.totalCredit);
  });
});

describe('Auto-removed products come back when stock returns', () => {
  it('a stockout takes the product off; a restock puts it back', async () => {
    const Product = mongoose.model('Product');
    const Inventory = mongoose.model('Inventory');
    await Inventory.updateOne({ _id: inv._id }, { $set: { stockQty: 10 } });
    const placed = await auth('post', '/api/orders', tok.afStaff).send({ items: [line(1)], table: 'Takeout' });
    const done = await auth('put', `/api/orders/${placed.body.order._id}`, tok.afSuper).send({ status: 'Completed' });
    expect(done.status).toBe(200);
    const off = await Product.findById(prod._id).lean();
    expect(off.isAvailable).toBe(false);
    expect(off.autoUnavailable).toBe(true);

    await Inventory.updateOne({ _id: inv._id }, { $inc: { stockQty: 500 } });
    const back = await waitFor(async () => (await Product.findById(prod._id).lean()).isAvailable === true);
    expect(back).toBe(true);
    expect((await Product.findById(prod._id).lean()).autoUnavailable).toBe(false);
  });

  it('a product removed by hand stays removed after a restock', async () => {
    const Product = mongoose.model('Product');
    const Inventory = mongoose.model('Inventory');
    const r = await auth('patch', `/api/products/${prod._id}/availability`, tok.afSuper).send({ isAvailable: false });
    expect(r.status).toBe(200);
    await Inventory.updateOne({ _id: inv._id }, { $inc: { stockQty: 100 } });
    await new Promise((res) => setTimeout(res, 3000));
    expect((await Product.findById(prod._id).lean()).isAvailable).toBe(false);
  });
});

describe('P2: append-only ledger and audit log', () => {
  it('a bulkWrite that rewrites a journal entry is refused', async () => {
    const JE = mongoose.model('JournalEntry');
    const je = await JE.create({ reference: 'AF-BULK', lines: [
      { accountCode: '111000', debit: 5, credit: 0 }, { accountCode: '410000', debit: 0, credit: 5 },
    ] });
    await expect(JE.bulkWrite([{ updateOne: { filter: { _id: je._id }, update: { $set: { description: 'rewritten' } } } }]))
      .rejects.toThrow(/append-only/);
    expect((await JE.findById(je._id).lean()).description).toBeFalsy();
  });
  it('an audit log row cannot be edited or deleted', async () => {
    const AuditLog = mongoose.model('AuditLog');
    const row = await AuditLog.create({ userId: 'af', action: 'TEST', targetReference: 'AF-1' });
    await expect(AuditLog.updateOne({ _id: row._id }, { $set: { action: 'CHANGED' } })).rejects.toThrow(/append-only/);
    await expect(AuditLog.deleteOne({ _id: row._id })).rejects.toThrow(/append-only/);
    expect((await AuditLog.findById(row._id).lean()).action).toBe('TEST');
  });
});

describe('P2: anonymous order view carries no customer name', () => {
  it('an order looked up without a token shows status and items, not who placed it', async () => {
    const placed = await auth('post', '/api/orders', tok.afStaff).send({ items: [line(1)], table: 'Takeout', customerName: 'Maria Santos' });
    const res = await request(app).get(`/api/orders/${placed.body.order._id}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBeTruthy();
    expect(res.body.customerName).toBeUndefined();
  });
});
