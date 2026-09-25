// Who may delete an order.
//
// An unpaid ticket is a typo: anyone at the till may delete it. A paid one is a
// sale - cancelling it takes it out of the drawer's expected cash, the oldest
// way to pocket a sale - so it needs someone who may void orders, or a
// manager's approval by PIN for that very order, checked by the server.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, staffTok, staff2Tok, mgrTok, latte;
const M = (n) => mongoose.model(n);
const as = (tok) => (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const ring = async () => (await as(staffTok)('post', '/api/orders').send({
  table: 'Dine-In', customerName: 'Guest',
  items: [{ productId: String(latte._id), name: 'Latte', price: 130, quantity: 1 }],
})).body.order;
const pay = (order) => as(staffTok)('put', `/api/orders/${order._id}`).send({ status: 'Preparing', paymentMethod: 'Cash', amountTendered: 200 });
const del = (order, tok = staffTok, extra = {}) => as(tok)('put', `/api/orders/${order._id}`).send({ status: 'Cancelled', ...extra });
const approve = (pin, target, tok = staffTok, permission = 'orders.delete') =>
  as(tok)('post', '/api/users/authorize').send({ pin, permission, target: String(target) });

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'TillStaff', role: 'staff' });
  await makeUser({ name: 'TillStaff2', role: 'staff' });
  await makeUser({ name: 'FloorMgr', role: 'manager' });
  // PINs: a manager who may void, and a second staff member who may not.
  await M('User').updateOne({ name: 'FloorMgr' }, { pinHash: await bcrypt.hash('4321', 4) });
  await M('User').updateOne({ name: 'TillStaff2' }, { pinHash: await bcrypt.hash('1111', 4) });
  staffTok = await loginStaff(app, 'TillStaff');
  staff2Tok = await loginStaff(app, 'TillStaff2');
  mgrTok = await loginStaff(app, 'FloorMgr');
}, 120000);
afterAll(async () => { await ctx.stop(); });
beforeEach(async () => {
  await M('Order').deleteMany({});
  await M('Product').deleteMany({});
  latte = await M('Product').create({ name: 'Latte', category: 'Coffee', basePrice: 130, businessType: 'fb' });
});

describe('an unpaid order', () => {
  it('can be deleted by anyone at the till', async () => {
    const order = await ring();
    const res = await del(order);
    expect(res.body.success).toBe(true);
    expect((await M('Order').findById(order._id).lean()).status).toBe('Cancelled');
  });
});

describe('a paid order', () => {
  it('cannot be deleted by staff on their own', async () => {
    const order = await ring();
    await pay(order);
    const res = await del(order);
    expect(res.status).toBe(403);
    expect(res.body.needsApproval).toBe('orders.delete');
    expect((await M('Order').findById(order._id).lean()).status).toBe('Preparing');
  });

  it('can be deleted by someone allowed to void orders', async () => {
    const order = await ring();
    await pay(order);
    const res = await del(order, mgrTok);
    expect(res.body.success).toBe(true);
    const stored = await M('Order').findById(order._id).lean();
    expect(stored).toMatchObject({ status: 'Cancelled', cancelledBy: 'FloorMgr', cancelApprovedBy: 'FloorMgr' });
  });

  it('can be deleted by staff with a manager\'s PIN approval for that order', async () => {
    const order = await ring();
    await pay(order);
    const ok = await approve('4321', order._id);
    expect(ok.body.approver.name).toBe('FloorMgr');
    const res = await del(order, staffTok, { approval: ok.body.approval });
    expect(res.body.success).toBe(true);
    const stored = await M('Order').findById(order._id).lean();
    expect(stored).toMatchObject({ status: 'Cancelled', cancelledBy: 'TillStaff', cancelApprovedBy: 'FloorMgr' });
    // Recorded in the audit with both names.
    const audit = await M('AuditLog').findOne({ action: 'Order_CANCEL', targetReference: String(order._id) }).lean();
    expect(audit.details.after).toMatchObject({ cancelledBy: 'TillStaff', approvedBy: 'FloorMgr', paid: true });
  });

  it('refuses a PIN that belongs to someone who may not void', async () => {
    const order = await ring();
    await pay(order);
    const res = await approve('1111', order._id);
    expect(res.status).toBe(403);
    expect(res.body.approval).toBeUndefined();
  });

  it('refuses an approval spent on a different order', async () => {
    const [a, b] = [await ring(), await ring()];
    await pay(a); await pay(b);
    const forA = (await approve('4321', a._id)).body.approval;
    expect((await del(b, staffTok, { approval: forA })).status).toBe(403);
  });

  it('refuses an approval handed to someone else at the till', async () => {
    const order = await ring();
    await pay(order);
    const mine = (await approve('4321', order._id)).body.approval;
    expect((await del(order, staff2Tok, { approval: mine })).status).toBe(403);
  });

  it('refuses a made-up approval', async () => {
    const order = await ring();
    await pay(order);
    expect((await del(order, staffTok, { approval: 'not-a-real-approval' })).status).toBe(403);
    expect((await del(order, staffTok, { approval: { approverName: 'FloorMgr' } })).status).toBe(403);
  });
});

describe('closing the day by hand', () => {
  it('needs the same permission, because it cancels paid orders too', async () => {
    expect((await as(staffTok)('post', '/api/orders/archive').send({})).status).toBe(403);
  });
});
