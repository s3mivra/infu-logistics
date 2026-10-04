// The sales reports can be narrowed to backdated sales (entered after the fact,
// or imported) or to live ones (the till, the portal). Left alone they cover
// both, as they always did - a backdated sale is a sale.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok, live, back;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const today = new Date().toISOString().slice(0, 10);
const range = `start=${today}&end=${today}`;

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'srcBoss', role: 'superadmin' });
  tok = await loginStaff(app, 'srcBoss');

  const placed = await auth('post', '/api/orders').send({
    table: 'Takeout', paymentMethod: 'Cash', customerName: 'Live Buyer',
    items: [{ name: 'Open Item', price: 300, quantity: 1 }],
  });
  await auth('put', `/api/orders/${placed.body.order._id}`).send({ status: 'Completed' });
  live = placed.body.order.orderNumber;

  // Straight after boot the database may still be building indexes, and a
  // transaction that lands then is told to retry - so retry.
  let b;
  for (let i = 0; i < 20; i++) {
    b = await auth('post', '/api/admin/backdate-sale').send({ date: today, amount: 700, paymentMethod: 'Cash', customerName: 'Late Entry' });
    if (b.status !== 500 || !/retry/i.test(String(b.body?.error))) break;
    await new Promise(r => setTimeout(r, 300));
  }
  expect(b.status, JSON.stringify(b.body)).toBe(200);
  back = b.body.order.orderNumber;
}, 120000);
afterAll(async () => { await ctx.stop(); });

const numbers = async (path, source) => {
  const r = await auth('get', `${path}?${range}${source ? `&source=${source}` : ''}`);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.rows.map(x => x.orderNumber);
};

describe('which sales a report covers', () => {
  for (const path of ['/api/reports/sales-line-items', '/api/reports/sales-documents']) {
    it(`${path}: all by default, or just one kind`, async () => {
      expect(await numbers(path)).toEqual(expect.arrayContaining([live, back]));
      const onlyBack = await numbers(path, 'backdated');
      expect(onlyBack).toContain(back);
      expect(onlyBack).not.toContain(live);
      const onlyLive = await numbers(path, 'live');
      expect(onlyLive).toContain(live);
      expect(onlyLive).not.toContain(back);
    });
  }

  it('an unknown value is ignored, not an error', async () => {
    expect(await numbers('/api/reports/sales-line-items', 'nonsense')).toEqual(expect.arrayContaining([live, back]));
  });
});
