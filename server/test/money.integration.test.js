// Batch 2 money/correctness integration tests (supertest + in-memory REPLICA SET).
//
// A replica set (not a standalone) is required because the spoilage handler — like the
// void/refund engines — now commits its stock write + journal inside a Mongo
// transaction, and transactions need a replica set.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import request from 'supertest';

let repl;
let app;
let adminToken;
let ownerToken;
let staffToken;

const login = async (name, password) =>
  (await request(app).post('/api/users/login').send({ name, password })).body.token;

beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
    instanceOpts: [{ launchTimeout: 30000 }],
  });
  process.env.NODE_ENV = 'test';
  process.env.MONGO_URI = repl.getUri();
  process.env.JWT_SECRET = 'test-secret-for-money-integration-tests';
  process.env.BUSINESS_TYPE = 'log';

  ({ app } = await import('../server.js'));
  if (mongoose.connection.readyState !== 1) {
    await new Promise((resolve, reject) => {
      mongoose.connection.once('connected', resolve);
      mongoose.connection.once('error', reject);
    });
  }

  const User = mongoose.model('User');
  const pw = await bcrypt.hash('pw', 12);
  await User.create([
    { name: 'MoneyOwner', password: pw, userCode: 'ADN-A8001', role: 'superadmin' },
    { name: 'MoneyAdmin', password: pw, userCode: 'ADN-A8002', role: 'admin' },
    { name: 'MoneyStaff', password: pw, userCode: 'ADN-A8003', role: 'staff' },
  ]);
  ownerToken = await login('MoneyOwner', 'pw');
  adminToken = await login('MoneyAdmin', 'pw');
  staffToken = await login('MoneyStaff', 'pw');
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  if (repl) await repl.stop();
});

describe('Batch 2 — voids are superadmin-only', () => {
  it('admin token → 403 on void (no longer admin-allowed)', async () => {
    const res = await request(app)
      .post('/api/orders/000000000000000000000000/void')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Restock' });
    expect(res.status).toBe(403);
  });

  it('superadmin token → not 403 on void (passes the role gate)', async () => {
    const res = await request(app)
      .post('/api/orders/000000000000000000000000/void')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ reason: 'Restock' });
    expect(res.status).not.toBe(403); // 404 — order not found — but the gate let it through
  });
});

describe('Batch 2 — spoilage commits a balanced journal entry inside a transaction', () => {
  it('decrements stock and posts a balanced DR 535000 / CR 130000 entry', async () => {
    const Inventory = mongoose.model('Inventory');
    const JournalEntry = mongoose.model('JournalEntry');
    const item = await Inventory.create({
      itemName: 'Test Flour', stockQty: 1000, unit: 'g', unitCost: 0.5, lowStockThreshold: 0,
    });

    const res = await request(app)
      .post(`/api/inventory/spoilage/${item._id}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ qty: 100, reason: 'Expired', note: 'integration test' });
    expect(res.status).toBe(200);

    const after = await Inventory.findById(item._id).lean();
    expect(after.stockQty).toBe(900); // 1000 − 100

    const je = await JournalEntry.findOne({ description: /Test Flour/ }).lean();
    expect(je).toBeTruthy();
    expect(je.totalDebit).toBeCloseTo(50, 6);   // 100 × 0.5
    expect(je.totalCredit).toBeCloseTo(50, 6);
    const dr = je.lines.reduce((s, l) => s + (l.debit || 0), 0);
    const cr = je.lines.reduce((s, l) => s + (l.credit || 0), 0);
    expect(dr).toBeCloseTo(cr, 6); // balanced
    const codes = je.lines.map((l) => l.accountCode).sort();
    expect(codes).toEqual(['130000', '535000']);
  });

  it('rejects spoiling more than on-hand stock (no partial write)', async () => {
    const Inventory = mongoose.model('Inventory');
    const item = await Inventory.create({ itemName: 'Scarce Sugar', stockQty: 10, unit: 'g', unitCost: 1 });
    const res = await request(app)
      .post(`/api/inventory/spoilage/${item._id}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ qty: 50, reason: 'Expired' });
    expect(res.status).toBe(400);
    const after = await Inventory.findById(item._id).lean();
    expect(after.stockQty).toBe(10); // unchanged
  });
});

describe('Batch 2 — percentage-tax report', () => {
  it('requires a date range', async () => {
    const res = await request(app)
      .get('/api/reports/percentage-tax')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(400);
  });

  it('taxes net collected at 3% and shows the discount subtraction (reconciles)', async () => {
    const Order = mongoose.model('Order');
    // Gross 1000, ₱100 discount → customer paid 900. Tax = 27.
    await Order.create({
      orderNumber: 'ORD-TEST-0001', status: 'Completed', isComplimentary: false,
      subtotal: 1000, discount: 100, total: 900, paymentMethod: 'Cash',
      createdAt: new Date('2026-02-15T10:00:00Z'),
    });
    // A voided order in the same window must NOT count.
    await Order.create({
      orderNumber: 'ORD-TEST-0002', status: 'Voided', isComplimentary: false,
      subtotal: 500, discount: 0, total: 500, paymentMethod: 'Cash',
      createdAt: new Date('2026-02-16T10:00:00Z'),
    });

    const res = await request(app)
      .get('/api/reports/percentage-tax?start=2026-02-01&end=2026-02-28')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.orders).toBe(1);              // voided order excluded
    expect(res.body.grossSales).toBe(1000);
    expect(res.body.discounts).toBe(100);
    expect(res.body.netCollected).toBe(900);      // the taxable base
    expect(res.body.taxDue).toBe(27);
    // reconciliation: gross − discounts === net collected
    expect(res.body.grossSales - res.body.discounts).toBe(res.body.netCollected);
    // discount subtraction is an explicit, visible line
    const discLine = res.body.lines.find((l) => /^less: sales discounts/i.test(l.label));
    expect(discLine.amount).toBe(-100);
  });

  it('blocks a non-superadmin (admin) from the report', async () => {
    const res = await request(app)
      .get('/api/reports/percentage-tax?start=2026-02-01&end=2026-02-28')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(403);
  });
});

describe('Batch 3 — journal CSV export is bounded + streamed', () => {
  it('rejects a request with no date range', async () => {
    const res = await request(app)
      .get('/api/journal/export')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(400);
  });

  it('rejects a range longer than one quarter', async () => {
    const res = await request(app)
      .get('/api/journal/export?start=2026-01-01&end=2026-12-31')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(400);
  });

  it('streams CSV (header row first) for a valid in-cap range', async () => {
    const end = new Date();
    const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    const iso = (d) => d.toISOString().slice(0, 10);
    const res = await request(app)
      .get(`/api/journal/export?start=${iso(start)}&end=${iso(end)}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text.startsWith('Date,Reference,Description,AccountCode,AccountName,Debit,Credit')).toBe(true);
  });
});

describe('Batch 3 — shift start enforces a valid starting cash', () => {
  it('rejects a missing starting cash (no silent default-to-0)', async () => {
    const res = await request(app)
      .post('/api/shifts/start')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('rejects a negative starting cash', async () => {
    const res = await request(app)
      .post('/api/shifts/start')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ startingCash: -5 });
    expect(res.status).toBe(400);
  });

  it('accepts a valid starting cash (incl. an explicit 0)', async () => {
    const res = await request(app)
      .post('/api/shifts/start')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ startingCash: 0 });
    expect(res.status).toBe(200);
    expect(res.body.shift.startingCash).toBe(0);
  });
});
