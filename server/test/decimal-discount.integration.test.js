// A discount that is not a whole number.
//
// Half a percent is a real promo ("12.5% off"), and a negotiated rate lands on
// odder numbers still. The money that comes out must be the exact percentage of
// the sale, rounded once, with the order still adding up to the penny.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok, latte;
const M = (n) => mongoose.model(n);
const as = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const sell = (discountPercent, price = 130, quantity = 1) => as('post', '/api/orders').send({
  table: 'Counter', paymentMethod: 'Cash', customerName: 'Test', discountPercent,
  items: [{ productId: String(latte._id), name: 'Latte', price, quantity }],
});

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'DiscBoss', role: 'superadmin' });
  tok = await loginStaff(app, 'DiscBoss');
}, 120000);
afterAll(async () => { await ctx.stop(); });
beforeEach(async () => {
  await M('Product').deleteMany({});
  latte = await M('Product').create({ name: 'Latte', category: 'Coffee', basePrice: 130 });
});

describe('a percentage with decimals', () => {
  it('is kept as typed on a saved promo', async () => {
    const res = await as('post', '/api/discounts').send({ name: 'Half percent promo', percentage: 12.5 });
    expect(res.body.discount.percentage).toBe(12.5);
    expect((await M('Discount').findById(res.body.discount._id).lean()).percentage).toBe(12.5);
  });

  it('takes exactly that share off the sale', async () => {
    const { body } = await sell(12.5);
    expect(body.order).toMatchObject({ discountPercent: 12.5, subtotal: 130, discount: 16.25, total: 113.75 });
  });

  it('rounds to the peso and centavo without losing a centavo of the total', async () => {
    for (const percent of [7.333, 3.14159, 0.5, 99.99]) {
      const { body } = await sell(percent);
      const o = body.order;
      const money = (n) => Math.round(n * 100) / 100;
      expect(o.discount).toBe(money(130 * percent / 100));
      // What the customer pays plus what they were let off is the sale itself.
      expect(money(o.total + o.discount)).toBe(130);
    }
  });

  it('keeps a finer rate than two decimals, wherever a rate is set', async () => {
    // A negotiated rate is whatever was agreed - the forms no longer round it,
    // so nothing between the keyboard and the database may either.
    const preset = await as('post', '/api/discounts').send({ name: 'Negotiated', percentage: 7.125 });
    expect((await M('Discount').findById(preset.body.discount._id).lean()).percentage).toBe(7.125);

    const rule = await as('post', '/api/discount-rules').send({ name: 'Bulk day', percent: 3.755 });
    expect((await M('DiscountRule').findById(rule.body.rule._id).lean()).percent).toBe(3.755);

    const tier = await as('post', '/api/price-tiers').send({ name: 'Wholesale', percent: 12.625 });
    expect((await M('PriceTier').findById(tier.body.tier._id).lean()).percent).toBe(12.625);

    const product = await as('post', '/api/products').send({
      name: 'Beans 1kg', category: 'Coffee', basePrice: 900, discountPercent: 6.875,
      bulkBreaks: [{ minQty: 10, percent: 9.125 }],
    });
    const stored = await M('Product').findById(product.body.product._id).lean();
    expect([stored.discountPercent, stored.bulkBreaks[0].percent]).toEqual([6.875, 9.125]);
  });

  it('prices a sale on a finer rate, to the centavo', async () => {
    const { body } = await sell(7.125);
    // 130 x 7.125% is 9.2625 - a centavo and a bit, rounded once.
    expect(body.order.discount).toBe(9.26);
    expect(body.order.total).toBe(120.74);
    expect(body.order.discountPercent).toBe(7.125);
  });

  it('still refuses a percentage that is not one', async () => {
    expect((await as('post', '/api/discounts').send({ name: 'Too much', percentage: 120 })).status).toBe(422);
    expect((await as('post', '/api/discounts').send({ name: 'Negative', percentage: -5 })).status).toBe(422);
  });

  it('applies to one line, the way the cashier discounts a single item', async () => {
    // A discount sent with a NEW order is ignored on purpose - only a
    // server-resolved product/client rate prices a line at the till. The
    // cashier's own per-item discount goes on afterwards, which is what the
    // register does, so that is what is tested here.
    const placed = await as('post', '/api/orders').send({
      table: 'Counter', paymentMethod: 'Cash', customerName: 'Test',
      items: [{ productId: String(latte._id), name: 'Latte', price: 130, quantity: 2 }],
    });
    expect(placed.body.order.total).toBe(260);

    const items = placed.body.order.items.map(i => ({ ...i, discountPercent: 12.5 }));
    const edited = await as('put', `/api/orders/${placed.body.order._id}`).send({ items });
    // Two at 130, an eighth off each.
    expect(edited.body.order.total).toBe(227.5);
  });
});
