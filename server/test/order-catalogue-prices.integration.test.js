// Order lines are charged catalogue prices, not the price the browser sends.
//
// The client portal and the QR menu send a `price` with every line. Until the
// order route re-priced lines itself, a client could post a ₱1 sack and be
// charged ₱1. Self-service lines now always take the catalogue price (size,
// add-on, active sale, or an accepted quote); staff may still ring up a
// different price at the till, and every such override is audited.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, makeClient, loginStaff, loginClient } from './helpers/harness.js';

let ctx, app, superTok, clientTok, client, rice, drink;
const M = (n) => mongoose.model(n);
const asClient = (items, extra = {}) => request(app).post('/api/orders').set('Authorization', `Bearer ${clientTok}`)
  .send({ items, paymentMethod: 'GCash', table: 'Client Order', ...extra });
const asStaff = (items, extra = {}) => request(app).post('/api/orders').set('Authorization', `Bearer ${superTok}`)
  .send({ items, paymentMethod: 'Cash', table: 'Pickup', ...extra });

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'PriceSuper', role: 'superadmin' });
  superTok = await loginStaff(app, 'PriceSuper');
  await makeClient({ username: 'priceclient' });
  client = await M('ClientAccount').findOne({ username: 'priceclient' }).lean();
  clientTok = await loginClient(app, 'priceclient');

  await M('Category').create({ name: 'Goods', department: 'Logistics' });
  rice = await M('Product').create({ name: 'Rice Sack', category: 'Goods', basePrice: 1450, addOns: [{ name: 'Gift Wrap', price: 25 }] });
  drink = await M('Product').create({ name: 'Iced Tea', category: 'Goods', basePrice: 80, sizes: [{ name: 'Large', price: 110 }] });
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('self-service orders', () => {
  it('charges the catalogue price whatever price the client sends', async () => {
    const res = await asClient([{ productId: String(rice._id), name: 'Rice Sack', price: 1, quantity: 2 }]);
    expect(res.status).toBe(200);
    expect(res.body.order.items[0].price).toBe(1450);
    expect(res.body.order.total).toBe(2900);
  });

  it('prices a picked size and add-ons from the product', async () => {
    const res = await asClient([
      { productId: String(drink._id), name: 'Iced Tea (Large)', price: 1, quantity: 1 },
      { productId: String(rice._id), name: 'Rice Sack', price: 1, quantity: 1, selectedAddOns: [{ name: 'Gift Wrap', price: 0 }] },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.order.items[0].price).toBe(110);
    expect(res.body.order.items[1].selectedAddOns[0].price).toBe(25);
    expect(res.body.order.total).toBe(110 + 1450 + 25);
  });

  it('treats the menu’s base-size choice as the base price', async () => {
    const res = await asClient([{ productId: String(drink._id), name: 'Iced Tea (Regular)', price: 1, quantity: 1 }]);
    expect(res.status).toBe(200);
    expect(res.body.order.items[0].price).toBe(80);
  });

  it('applies an active sale price', async () => {
    const now = Date.now();
    const sale = await M('Sale').create({
      name: 'Flash', isActive: true, startsAt: new Date(now - 3600e3), endsAt: new Date(now + 3600e3),
      rules: [{ ruleType: 'fixed_price', productId: String(rice._id), salePrice: 1200 }],
    });
    const res = await asClient([{ productId: String(rice._id), name: 'Rice Sack', price: 1450, quantity: 1 }]);
    expect(res.body.order.items[0].price).toBe(1200);
    await M('Sale').deleteOne({ _id: sale._id });
  });

  it('refuses a line that is not in the catalogue, or an unknown size or option', async () => {
    expect((await asClient([{ name: 'Free Money', price: 0, quantity: 1 }])).status).toBe(400);
    expect((await asClient([{ productId: String(drink._id), name: 'Iced Tea (Tiny)', price: 1, quantity: 1 }])).status).toBe(400);
    expect((await asClient([{ productId: String(rice._id), name: 'Rice Sack', price: 1450, quantity: 1, selectedAddOns: [{ name: 'Gold Leaf', price: 0 }] }])).status).toBe(400);
  });

  it('charges an accepted quote at the quoted price, with no discount on top, and uses the quote up', async () => {
    await M('Product').updateOne({ _id: rice._id }, { $set: { clientDiscounts: [{ clientId: String(client._id), percent: 10 }] } });
    const q = await M('Quotation').create({
      quoteNumber: 'QUO-T1', clientAccountId: client._id, clientName: client.name, status: 'Accepted',
      lines: [{ productId: rice._id, name: 'Rice Sack', quantity: 100, quotedPrice: 1300 }],
    });
    const res = await asClient([{ productId: String(rice._id), name: 'Rice Sack', price: 1300, quantity: 100 }]);
    expect(res.status).toBe(200);
    expect(res.body.order.items[0].price).toBe(1300);
    expect(res.body.order.total).toBe(130000);
    expect((await M('Quotation').findById(q._id).lean()).orderNumber).toBe(res.body.order.orderNumber);

    // Used up: the next order pays list price less the client's own 10%.
    const again = await asClient([{ productId: String(rice._id), name: 'Rice Sack', price: 1300, quantity: 1 }]);
    expect(again.body.order.total).toBe(1305);
    await M('Product').updateOne({ _id: rice._id }, { $set: { clientDiscounts: [] } });
  });
});

describe('staff at the till', () => {
  it('keeps an entered price but audits the override', async () => {
    const res = await asStaff([{ productId: String(rice._id), name: 'Rice Sack', price: 1000, quantity: 1 }]);
    expect(res.status).toBe(200);
    expect(res.body.order.items[0].price).toBe(1000);
    const log = await M('AuditLog').findOne({ targetReference: String(res.body.order._id), action: /PRICEOVERRIDE/ }).lean();
    expect(log.details.after.overrides[0]).toMatchObject({ item: 'Rice Sack', catalogue: 1450, charged: 1000 });
  });

  it('writes no override entry when the price matches', async () => {
    const res = await asStaff([{ productId: String(rice._id), name: 'Rice Sack', price: 1450, quantity: 1 }]);
    expect(await M('AuditLog').countDocuments({ targetReference: String(res.body.order._id), action: /PRICEOVERRIDE/ })).toBe(0);
  });
});
