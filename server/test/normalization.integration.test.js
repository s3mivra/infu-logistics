// Input-normalization integration tests.
// Proves the canonical-form rules survive a real HTTP round-trip: the three
// spellings of a supplier name collapse to one record, client usernames are
// stored lowercase, and legacy mixed-case client logins still work.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let app, stop, superToken;

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'log', jwtSecret: 'norm-test-secret-0123456789' }));
  await makeUser({ name: 'NormBoss', role: 'superadmin', password: 'pw' });
  await mongoose.model('User').updateMany({}, { $set: { tenantId: null } });
  superToken = await loginStaff(app, 'NormBoss', 'pw');
}, 120000);

afterAll(async () => { await stop(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });

describe('supplier name canonicalization', () => {
  it('stores a canonical Title Case name', async () => {
    const res = await request(app).post('/api/suppliers').set(auth(superToken))
      .send({ name: '  kasa   lokal  trading ', email: 'SALES@Kasa.TEST', contactPerson: 'juan dela cruz' });
    expect(res.status).toBe(201);
    expect(res.body.supplier.name).toBe('Kasa Lokal Trading');
    expect(res.body.supplier.email).toBe('sales@kasa.test');
    expect(res.body.supplier.contactPerson).toBe('Juan Dela Cruz');
  });

  it('rejects the same supplier typed in a different case as a duplicate', async () => {
    const res = await request(app).post('/api/suppliers').set(auth(superToken))
      .send({ name: 'KASA LOKAL TRADING' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/i);
  });

  it('still rejects a blank name', async () => {
    const res = await request(app).post('/api/suppliers').set(auth(superToken)).send({ name: '   ' });
    expect(res.status).toBe(400);
  });

  it('blocks a rename that collides with another supplier', async () => {
    const other = await request(app).post('/api/suppliers').set(auth(superToken)).send({ name: 'Other Supplier' });
    const res = await request(app).patch(`/api/suppliers/${other.body.supplier._id}`).set(auth(superToken))
      .send({ name: 'kasa lokal trading' });
    expect(res.status).toBe(409);
  });

  it('allows renaming a supplier to its own canonical form (no self-collision)', async () => {
    const made = await request(app).post('/api/suppliers').set(auth(superToken)).send({ name: 'Self Rename Co' });
    const res = await request(app).patch(`/api/suppliers/${made.body.supplier._id}`).set(auth(superToken))
      .send({ name: 'SELF RENAME CO' });
    expect(res.status).toBe(200);
    expect(res.body.supplier.name).toBe('Self Rename Co');
  });
});

describe('client account username canonicalization', () => {
  it('lowercases the username and title-cases the business name', async () => {
    const res = await request(app).post('/api/client-accounts').set(auth(superToken))
      .send({ username: '  KasaLokal ', password: 'pw1234', name: 'kasa lokal inc' });
    expect(res.status).toBe(200);
    expect(res.body.client.username).toBe('kasalokal');
    expect(res.body.client.name).toBe('Kasa Lokal Inc');
  });

  it('treats a differently-cased username as already taken', async () => {
    const res = await request(app).post('/api/client-accounts').set(auth(superToken))
      .send({ username: 'KASALOKAL', password: 'pw1234', name: 'Impostor' });
    expect(res.status).toBe(409);
  });

  it('logs in regardless of the case the client types', async () => {
    for (const typed of ['kasalokal', 'KasaLokal', '  KASALOKAL  ']) {
      const res = await request(app).post('/api/client-auth/login').send({ username: typed, password: 'pw1234' });
      expect(res.status).toBe(200);
    }
  });

  it('does not lock out a legacy account stored with mixed case', async () => {
    // Written straight to the DB to simulate a row created before normalization.
    const ClientAccount = mongoose.model('ClientAccount');
    await ClientAccount.create({
      clientCode: 'CUS-1000-A9999', username: 'LegacyMixedCase',
      password: await bcrypt.hash('pw1234', 4), name: 'Legacy Co', paymentMethod: 'Cash',
    });
    const res = await request(app).post('/api/client-auth/login').send({ username: 'legacymixedcase', password: 'pw1234' });
    expect(res.status).toBe(200);
  });
});

describe('inventory item name canonicalization', () => {
  const mk = (itemName) => request(app).post('/api/inventory').set(auth(superToken)).send({
    itemName, unit: 'ml', displayUnit: 'L', unitMultiplier: 1000, packSize: 1,
    stockQty: 10000, unitCost: 0.08, creditAccount: '220000',
  });

  it('upper-cases the name (matches the billing statement convention) and squishes whitespace', async () => {
    const res = await mk('  test   milk 1l ');
    expect(res.status).toBe(200);
    expect(res.body.item.itemName).toBe('TEST MILK 1L');
  });

  it('rejects the same item typed in another case as a duplicate', async () => {
    const res = await mk('TEST MILK 1L');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already exists/i);
  });
});

describe('order customer names', () => {
  it('canonicalizes the buyer name that gets printed on receipts and DRs', async () => {
    const prod = await request(app).post('/api/products').set(auth(superToken))
      .send({ name: 'DR Test Item', category: 'Dry Goods', basePrice: 100 });
    const res = await request(app).post('/api/orders').set(auth(superToken)).send({
      customerName: '  acme   trading corp ',
      items: [{ productId: prod.body.product._id, name: 'DR Test Item', price: 100, quantity: 1 }],
    });
    expect(res.status).toBeLessThan(300);
    expect(res.body.order.customerName).toBe('Acme Trading Corp');
  });

  it('leaves an absent customer name alone', async () => {
    const prod = await request(app).post('/api/products').set(auth(superToken))
      .send({ name: 'DR Test Item 2', category: 'Dry Goods', basePrice: 100 });
    const res = await request(app).post('/api/orders').set(auth(superToken)).send({
      items: [{ productId: prod.body.product._id, name: 'DR Test Item 2', price: 100, quantity: 1 }],
    });
    expect(res.status).toBeLessThan(300);
    expect(res.body.order.customerName ?? '').not.toMatch(/undefined|null/i);
  });
});

describe('money fields accept what people actually type', () => {
  it('accepts a comma-formatted peso amount on a product', async () => {
    const res = await request(app).post('/api/products').set(auth(superToken))
      .send({ name: 'comma priced item', category: 'Dry Goods', basePrice: '1,500.50' });
    expect(res.status).toBeLessThan(300);
    expect(res.body.product.basePrice).toBe(1500.5);
    expect(res.body.product.name).toBe('Comma Priced Item');
  });

  it('rejects junk in a money field with a 422', async () => {
    const res = await request(app).post('/api/products').set(auth(superToken))
      .send({ name: 'Bad Price', category: 'Dry Goods', basePrice: 'abc' });
    expect(res.status).toBe(422);
  });
});
