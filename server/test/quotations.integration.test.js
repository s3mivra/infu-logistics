// Quotations: a price asked for, not a sale made.
//
// The rule the whole feature rests on is that a quotation posts NOTHING. No
// revenue, no receivable, no stock movement, no journal entry. A business that
// quotes ten jobs a week and wins three has not earned ten jobs' worth of
// anything, and books that said otherwise would be lying.
//
// That is also why it is its own collection rather than another Order status:
// an order-shaped quote would have to be excluded by every sales report, the
// EOD close, the P&L and the A/R list, and the first one that forgot would
// show revenue for something nobody had agreed to buy. These tests check that
// separation holds as well as the flow itself.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, staffTok, clientTok, client, product;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${staffTok}`);
const asClient = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${clientTok}`);
const M = (n) => mongoose.model(n);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'QuoteSuper', role: 'superadmin' });
  staffTok = await loginStaff(app, 'QuoteSuper');
}, 120000);

afterAll(async () => { await ctx.stop(); });

beforeEach(async () => {
  for (const n of ['Quotation', 'Order', 'JournalEntry', 'ClientAccount', 'Product', 'Category']) {
    await M(n).deleteMany({});
  }
  await M('Category').create({ name: 'Beans' });
  product = await M('Product').create({
    productCode: 'P-1', name: 'Specialty Vietnam Lam Dong', category: 'Beans', basePrice: 1800,
  });

  // A wholesale buyer, created the way the import does and then given a login.
  const created = await auth('post', '/api/client-accounts').send({
    username: 'kasalokal', password: 'Wholesale1!', name: 'Kasa Lokal',
    paymentMethod: 'Account', creditLimit: 100000,
  });
  client = created.body.client;
  const login = await request(app).post('/api/client-auth/login')
    .send({ username: 'kasalokal', password: 'Wholesale1!' });
  clientTok = login.body.token;
});

const askForQuote = (over = {}) => asClient('post', '/api/client/quotations').send({
  items: [{ productId: String(product._id), name: product.name, quantity: 200, price: 1800 }],
  notes: 'Delivered to Cebu, please include freight.',
  ...over,
});

const priceIt = (id, over = {}) => auth('post', `/api/quotations/${id}/quote`).send({
  lines: [{ index: 0, quotedPrice: 1650 }],
  validUntil: '2030-12-31',
  quoteNotes: 'Freight included. Lead time 10 days.',
  ...over,
});

describe('a client asking for a price', () => {
  it('records the request without ordering anything', async () => {
    const res = await askForQuote();
    expect(res.body.success).toBe(true);
    expect(res.body.quotation.quoteNumber).toMatch(/^QUO-/);
    expect(res.body.quotation.status).toBe('Requested');
    // The one thing that must be true of every quotation, always.
    expect(await M('Order').countDocuments({})).toBe(0);
    expect(await M('JournalEntry').countDocuments({})).toBe(0);
  }, 30000);

  it('says plainly that nothing has been bought', async () => {
    const res = await askForQuote();
    expect(res.body.note).toMatch(/nothing has been ordered or charged/i);
  }, 30000);

  it('keeps what they were expecting to pay', async () => {
    const { body } = await askForQuote();
    expect(body.quotation.askedTotal).toBe(360000);   // 200 x 1800
    expect(body.quotation.quotedTotal).toBeNull();     // nobody has priced it yet
  }, 30000);

  it('refuses an empty request', async () => {
    const res = await askForQuote({ items: [] });
    expect(res.status).toBe(400);
  }, 30000);

  it('shows a client only their own quotations', async () => {
    await askForQuote();
    const mine = await asClient('get', '/api/client/quotations');
    expect(mine.body.quotations).toHaveLength(1);

    // Someone else's quote, which must never appear on this list.
    const other = await M('ClientAccount').create({
      clientCode: 'CUS-1000-A9', username: 'other', password: 'x', name: 'Other Co',
    });
    await M('Quotation').create({
      quoteNumber: 'QUO-X', clientAccountId: other._id, clientName: 'Other Co',
      lines: [{ name: 'Something', quantity: 1 }],
    });
    const again = await asClient('get', '/api/client/quotations');
    expect(again.body.quotations).toHaveLength(1);
  }, 30000);
});

describe('pricing it', () => {
  it('sends back a price with a validity date', async () => {
    const { body } = await askForQuote();
    const res = await priceIt(body.quotation._id);
    expect(res.body.success).toBe(true);
    expect(res.body.quotation.status).toBe('Quoted');
    expect(res.body.quotation.quotedTotal).toBe(330000);   // 200 x 1650
    expect(res.body.quotation.quoteNotes).toMatch(/freight/i);
  }, 30000);

  it('refuses to send a half-priced quote', async () => {
    const { body } = await asClient('post', '/api/client/quotations').send({
      items: [
        { name: 'Beans', quantity: 10, price: 100 },
        { name: 'Sacks', quantity: 10, price: 20 },
      ],
    });
    // A number the client cannot act on is worse than no number.
    const res = await auth('post', `/api/quotations/${body.quotation._id}/quote`)
      .send({ lines: [{ index: 0, quotedPrice: 90 }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/price every line/i);
  }, 30000);

  it('still posts nothing', async () => {
    const { body } = await askForQuote();
    await priceIt(body.quotation._id);
    expect(await M('JournalEntry').countDocuments({})).toBe(0);
    expect(await M('Order').countDocuments({})).toBe(0);
  }, 30000);

  it('refuses a negative price', async () => {
    const { body } = await askForQuote();
    const res = await priceIt(body.quotation._id, { lines: [{ index: 0, quotedPrice: -5 }] });
    expect(res.status).toBe(400);
  }, 30000);
});

describe('the client answering', () => {
  it('hands back the quoted prices to order at, not the list prices', async () => {
    const { body } = await askForQuote();
    await priceIt(body.quotation._id);

    const res = await asClient('post', `/api/client/quotations/${body.quotation._id}/accept`).send({});
    expect(res.body.success).toBe(true);
    // The client agreed to 1,650. Charging the 1,800 list price would be a
    // different agreement from the one they accepted.
    expect(res.body.items[0].price).toBe(1650);
    expect(res.body.total).toBe(330000);
    expect(res.body.quotation.status).toBe('Accepted');
  }, 30000);

  it('will not accept a price that was never given', async () => {
    const { body } = await askForQuote();
    const res = await asClient('post', `/api/client/quotations/${body.quotation._id}/accept`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/only a quoted price/i);
  }, 30000);

  it('will not accept one that has run out', async () => {
    const { body } = await askForQuote();
    await priceIt(body.quotation._id, { validUntil: '2020-01-01' });

    const res = await asClient('post', `/api/client/quotations/${body.quotation._id}/accept`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/expired/i);
  }, 30000);

  it('reads an out-of-date quote as expired without a job having to run', async () => {
    const { body } = await askForQuote();
    await priceIt(body.quotation._id, { validUntil: '2020-01-01' });
    const mine = await asClient('get', '/api/client/quotations');
    // Computed on read: a nightly job that has not run yet would leave a dead
    // price looking live.
    expect(mine.body.quotations[0].status).toBe('Expired');
  }, 30000);

  it('can be declined, and says why', async () => {
    const { body } = await askForQuote();
    await priceIt(body.quotation._id);
    const res = await asClient('post', `/api/client/quotations/${body.quotation._id}/decline`)
      .send({ reason: 'Found it cheaper elsewhere' });
    expect(res.body.quotation.status).toBe('Declined');
    expect(await M('Order').countDocuments({})).toBe(0);
  }, 30000);
});

describe('turning it into an order', () => {
  it('ties the two together so a quote cannot be spent twice', async () => {
    const { body } = await askForQuote();
    await priceIt(body.quotation._id);
    const accepted = await asClient('post', `/api/client/quotations/${body.quotation._id}/accept`).send({});

    const order = await auth('post', '/api/orders').send({
      table: 'Client Order', paymentMethod: 'Credit',
      customerName: 'Kasa Lokal', items: accepted.body.items,
    });
    expect(order.status).toBe(200);

    const link = await auth('post', `/api/quotations/${body.quotation._id}/link-order`)
      .send({ orderId: order.body.order._id });
    expect(link.body.quotation.orderNumber).toBe(order.body.order.orderNumber);

    const twice = await auth('post', `/api/quotations/${body.quotation._id}/link-order`)
      .send({ orderId: order.body.order._id });
    expect(twice.status).toBe(409);
  }, 60000);

  it('leaves the ordinary order path to do the accounting', async () => {
    const { body } = await askForQuote();
    await priceIt(body.quotation._id);
    const accepted = await asClient('post', `/api/client/quotations/${body.quotation._id}/accept`).send({});

    const order = await auth('post', '/api/orders').send({
      table: 'Client Order', paymentMethod: 'Credit',
      customerName: 'Kasa Lokal', items: accepted.body.items,
    });
    await auth('put', `/api/orders/${order.body.order._id}`).send({ status: 'Completed' });

    // Only now does anything reach the ledger, and it does so through the same
    // route every other order uses rather than a second implementation.
    const entries = await M('JournalEntry').find({}).lean();
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) expect(e.totalDebit).toBeCloseTo(e.totalCredit, 2);
  }, 60000);
});

describe('who has to be quoted', () => {
  it('is off by default, so a regular buyer just orders', async () => {
    const fresh = await M('ClientAccount').findById(client._id).lean();
    expect(fresh.requiresQuote).toBe(false);
  }, 30000);

  it('can be turned on for the buyers who need it', async () => {
    await auth('patch', `/api/client-accounts/${client._id}`).send({ requiresQuote: true });
    const fresh = await M('ClientAccount').findById(client._id).lean();
    expect(fresh.requiresQuote).toBe(true);
  }, 30000);
});

// The portal has to know which of the two carts to show, and the client list
// screen has to be able to switch it. A flag the API accepts but never reports
// back is a switch with no light on it.
describe('the portal knowing which cart to show', () => {
  it('reports the flag on the client profile', async () => {
    await auth('patch', `/api/client-accounts/${client._id}`).send({ requiresQuote: true });
    const me = await asClient('get', '/api/client/profile');
    expect(me.body.profile.requiresQuote).toBe(true);
  }, 30000);

  it('reports it as off for an ordinary buyer', async () => {
    const me = await asClient('get', '/api/client/profile');
    expect(me.body.profile.requiresQuote).toBe(false);
  }, 30000);

  it('can be set when the account is first created', async () => {
    const res = await auth('post', '/api/client-accounts').send({
      username: 'wholesaleco', password: 'Wholesale1!', name: 'Wholesale Co',
      requiresQuote: true,
    });
    const fresh = await M('ClientAccount').findById(res.body.client._id).lean();
    expect(fresh.requiresQuote).toBe(true);
  }, 30000);
});
