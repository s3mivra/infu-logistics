// Barcode support — the barcode field on Product (through create) and the
// POS by-barcode lookup, including the ambiguous-match flag.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, staffTok;
const auth = (method, path, token) => request(app)[method](path).set('Authorization', `Bearer ${token}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'bcStaff', role: 'staff' });
  staffTok = await loginStaff(app, 'bcStaff');
  await mongoose.model('Category').create({ name: 'BC-Cat', department: 'Kitchen' });
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('barcode lookup', () => {
  it('creates a product carrying a barcode (Zod allows it through)', async () => {
    const res = await auth('post', '/api/products', staffTok).send({
      name: 'Scannable Widget', category: 'BC-Cat', basePrice: 25, barcode: '4800001234567',
    });
    expect(res.status).toBe(200);
    expect(res.body.product.barcode).toBe('4800001234567');
  });

  it('resolves a scanned barcode to the product', async () => {
    const res = await auth('get', '/api/products/by-barcode/4800001234567', staffTok);
    expect(res.status).toBe(200);
    expect(res.body.product.name).toBe('Scannable Widget');
    expect(res.body.ambiguous).toBe(false);
  });

  it('404s an unknown barcode', async () => {
    const res = await auth('get', '/api/products/by-barcode/0000000000000', staffTok);
    expect(res.status).toBe(404);
  });

  it('flags ambiguous when two products share a barcode', async () => {
    await auth('post', '/api/products', staffTok).send({
      name: 'Twin A', category: 'BC-Cat', basePrice: 10, barcode: 'DUP-123',
    });
    await auth('post', '/api/products', staffTok).send({
      name: 'Twin B', category: 'BC-Cat', basePrice: 12, barcode: 'DUP-123',
    });
    const res = await auth('get', '/api/products/by-barcode/DUP-123', staffTok);
    expect(res.status).toBe(200);
    expect(res.body.ambiguous).toBe(true);
    expect(res.body.matchCount).toBe(2);
  });
});
