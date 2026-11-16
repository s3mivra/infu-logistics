// The duplicate checker (lib/dupes.js) and names kept in capitals (lib/caps.js).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';
import { applyCaps, capsPipeline } from '../lib/caps.js';
import { nameKey } from '../lib/dupes.js';

let ctx, app, tok;
beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'DcOwner', role: 'superadmin' });
  tok = await loginStaff(app, 'DcOwner');
  for (let i = 0; i < 120; i++) {
    if ((await request(app).get('/health')).body.startup === 'ready') break;
    await new Promise((r) => setTimeout(r, 500));
  }
}, 120000);
afterAll(async () => { await ctx.stop(); });

const post = (path, body) => request(app).post(path).set('Authorization', `Bearer ${tok}`).send(body);

describe('capitals', () => {
  it('the setter puts a product and its sizes in capitals (on its own models, so no other test sees it)', async () => {
    const own = new mongoose.Mongoose();
    const Product = own.model('Product', new own.Schema({ name: String, sizes: [{ name: String, price: Number }] }));
    expect(applyCaps(own)).toBe(2);
    const p = new Product({ name: 'Iced Latte', sizes: [{ name: 'Large', price: 140 }] });
    expect(p.name).toBe('ICED LATTE');
    expect(p.sizes[0].name).toBe('LARGE');
    p.name = 'iced latte deluxe';
    expect(p.name).toBe('ICED LATTE DELUXE');
  });

  it('the one-time pass converts what is stored, and leaves missing fields missing', async () => {
    const col = mongoose.model('Product').collection;
    const { insertedId } = await col.insertOne({ name: 'old mocha', price: 1, sizes: [{ name: 'small', price: 1 }, { price: 2 }], addOns: 'not-an-array' });
    await col.updateOne({ _id: insertedId }, capsPipeline({ fields: ['name', 'description'], arrays: { sizes: ['name'], addOns: ['name'] } }));
    const d = await col.findOne({ _id: insertedId });
    expect(d.name).toBe('OLD MOCHA');
    expect('description' in d).toBe(false);
    expect(d.sizes[0].name).toBe('SMALL');
    expect('name' in d.sizes[1]).toBe(false);
    expect(d.addOns).toBe('not-an-array');
  });
});

describe('duplicate names', () => {
  it('reads names with case, spaces and punctuation ignored', () => {
    expect(nameKey('Hibiscus-Tea ')).toBe(nameKey('hibiscus  tea'));
  });

  it('a product that reads the same asks first, and saves on "save anyway"', async () => {
    const base = { category: 'Tea', basePrice: 100 };
    const a = await post('/api/products', { ...base, name: 'Hibiscus Tea' });
    expect(a.status, JSON.stringify(a.body)).toBeLessThan(300);
    const same = await post('/api/products', { ...base, name: 'hibiscus tea' });
    expect(same.status).toBe(409);
    expect(same.body.duplicateOf).toBeUndefined();
    const look = await post('/api/products', { ...base, name: 'Hibiscus-Tea' });
    expect(look.status).toBe(409);
    expect(look.body.duplicateOf?.name).toBe('Hibiscus Tea');
    const ok = await post('/api/products', { ...base, name: 'Hibiscus-Tea', allowDuplicate: true });
    expect(ok.status, JSON.stringify(ok.body)).toBeLessThan(300);
  });

  it('a stock item written the same way keeps its own refusal', async () => {
    const a = await post('/api/inventory', { itemName: 'Milk', unit: 'ml', stockQty: 0 });
    expect(a.status, JSON.stringify(a.body)).toBeLessThan(300);
    expect((await post('/api/inventory', { itemName: 'milk', unit: 'ml' })).body.error).toBe('Item already exists.');
    expect((await post('/api/inventory', { itemName: 'M.I.L.K', unit: 'ml' })).body.duplicateOf).toBeTruthy();
  });
});

describe('duplicate transactions', () => {
  it('the same backdated sale twice on one day asks first', async () => {
    const body = { date: '2026-11-09', paymentMethod: 'Cash', customerName: 'Ana', items: [{ name: 'Tea', price: 50, quantity: 2 }] };
    expect((await post('/api/admin/backdate-sale', body)).status).toBe(200);
    const again = await post('/api/admin/backdate-sale', body);
    expect(again.status).toBe(409);
    expect(again.body.duplicateOf?.label).toMatch(/ana/i);
    expect((await post('/api/admin/backdate-sale', { ...body, allowDuplicate: true })).status).toBe(200);
    // A different customer the same day is not a duplicate.
    expect((await post('/api/admin/backdate-sale', { ...body, customerName: 'Ben' })).status).toBe(200);
  });
});
