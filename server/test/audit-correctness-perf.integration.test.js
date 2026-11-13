// 2026-11 audit, M107 and M112: month-end checklist, client exposure, bounded
// report windows, and product photos served at their own cacheable address.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, superTok;
const M = (n) => mongoose.model(n);
const as = (method, path) => request(app)[method](path).set('Authorization', `Bearer ${superTok}`);
// A 1x1 PNG, as the product form stores it.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'CpOwner', role: 'superadmin' });
  superTok = await loginStaff(app, 'CpOwner');
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('product photos (M112)', () => {
  let product;
  beforeAll(async () => {
    product = await M('Product').create({ name: 'Photo Item', basePrice: 50, category: 'Test', image: PNG, businessType: 'log' });
  });

  it('the catalogue lists an address, not the photo itself', async () => {
    const res = await request(app).get('/api/products');
    const row = res.body.find?.((p) => p.name === 'Photo Item') || (res.body.products || []).find((p) => p.name === 'Photo Item');
    expect(row.image).toMatch(new RegExp(`/api/products/${product._id}/image\\?v=\\d+$`));
    expect(JSON.stringify(res.body)).not.toContain('base64');
  });

  it('the address serves the photo, cacheable for a year', async () => {
    const res = await request(app).get(`/api/products/${product._id}/image`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toContain('immutable');
    expect(res.body.length).toBeGreaterThan(50);
  });

  it('saving the form with that address keeps the stored photo', async () => {
    const list = await as('get', '/api/products');
    const row = (Array.isArray(list.body) ? list.body : list.body.products).find((p) => p.name === 'Photo Item');
    const put = await as('put', `/api/products/${product._id}`).send({ name: 'Photo Item', image: row.image });
    expect(put.status).toBeLessThan(400);
    const after = await M('Product').findById(product._id, { image: 1 }).lean();
    expect(after.image).toBe(PNG);
  });
});

describe('client exposure counts what is unpaid (M107)', () => {
  it('a mostly paid invoice is not counted at face value', async () => {
    const client = await M('ClientAccount').create({ clientCode: 'CLT-EXP', name: 'Partly Paid Co', username: 'partlypaid', password: 'x', paymentMethod: 'On Account' });
    await M('Order').create({
      orderNumber: 'ORD-EXP-1', businessType: 'log', clientAccountId: client._id, customerName: 'Partly Paid Co',
      status: 'Completed', paymentMethod: 'On Account', total: 1000, subtotal: 1000, arPaidAmount: 900,
      items: [{ name: 'X', quantity: 1, price: 1000 }],
    });
    const res = await as('get', '/api/clients/summary');
    const row = res.body.clients.find((c) => c.name === 'Partly Paid Co');
    expect(row.exposure).toBe(100);
  });
});

describe('report windows are bounded (M107)', () => {
  it('stock movement refuses a range longer than a year', async () => {
    const res = await as('get', '/api/analytics/stock-movement?start=2000-01-01&end=2026-10-31');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at most a year/);
  });
});

describe('month-end checklist (M107)', () => {
  it('lists only bank accounts under "bank reconciled"', async () => {
    await M('JournalEntry').create({
      reference: 'JE-BANK-1', date: new Date('2026-09-10T04:00:00Z'), description: 'Deposit',
      lines: [{ accountCode: '112000', debit: 500, credit: 0 }, { accountCode: '410000', debit: 0, credit: 500 }],
    });
    const res = await as('get', '/api/periods/checklist?year=2026&month=9');
    const bank = (res.body.items || res.body.checklist || []).find((i) => i.key === 'bank');
    expect(bank.detail).toContain('112000');
    expect(bank.detail).not.toContain('410000');
  });
});
