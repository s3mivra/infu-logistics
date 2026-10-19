// Socket.io real-time layer: handshake JWT verification, server-decided room placement,
// the no-op client stubs, and a live broadcast reaching a subscribed device. Needs the
// http.Server listening on a real port (guarded off in test mode, so we listen manually).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { io as ioClient } from 'socket.io-client';
import { bootApp, makeUser, makeClient, loginStaff, loginClient } from './helpers/harness.js';

let ctx, app, server, port, adminTok, financeTok, clientTok, productId;

const connect = (opts = {}) => new Promise((resolve, reject) => {
  const s = ioClient(`http://127.0.0.1:${port}`, { transports: ['websocket'], reconnection: false, ...opts });
  s.on('connect', () => resolve(s));
  s.on('connect_error', reject);
  setTimeout(() => reject(new Error('socket connect timeout')), 8000);
});

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  server = ctx.server;
  await makeUser({ name: 'sk_admin', role: 'admin' });
  adminTok = await loginStaff(app, 'sk_admin');
  await makeUser({ name: 'sk_finance', role: 'finance' });
  financeTok = await loginStaff(app, 'sk_finance');
  await makeClient({ username: 'sk_client' });
  clientTok = await loginClient(app, 'sk_client');

  const Inventory = mongoose.model('Inventory');
  const Product = mongoose.model('Product');
  const Category = mongoose.model('Category');
  await Category.create({ name: 'SK', department: 'Kitchen' });
  const inv = await Inventory.create({ itemName: 'SK Bean', stockQty: 1000, unit: 'g', unitCost: 0.5 });
  productId = String((await Product.create({ name: 'SK Brew', category: 'SK', basePrice: 100, baseRecipe: [{ invId: String(inv._id), name: 'SK Bean', qty: 5, cost: 2.5, unit: 'g' }] }))._id);

  await new Promise((res) => server.listen(0, res)); // ephemeral port
  port = server.address().port;
}, 120000);

afterAll(async () => {
  await new Promise((res) => server.close(res));
  await ctx.stop();
});

describe('socket.io real-time', () => {
  it('an authenticated device joins its rooms and receives an ops broadcast', async () => {
    const s = await connect({ auth: { token: adminTok } });
    const received = new Promise((resolve) => s.once('newOrder', resolve));

    // Creating an order fires emitToOps('newOrder') to the cashier room (admin is in it).
    const r = await request(app).post('/api/orders').set('Authorization', `Bearer ${adminTok}`)
      .send({ items: [{ productId, name: 'SK Brew', price: 100, quantity: 1 }], table: 'Takeout', paymentMethod: 'Cash' });
    expect(r.status).toBe(200);

    const evt = await Promise.race([received, new Promise((_, rej) => setTimeout(() => rej(new Error('no broadcast')), 5000))]);
    expect(evt).toBeTruthy();
    s.close();
  });

  it("a client-portal token does NOT receive other customers' orders", async () => {
    // A customer's JWT is valid too, and used to land in the staff 'cashier'
    // room - every order, live, with names and totals.
    const s = await connect({ auth: { token: clientTok } });
    let leaked = false;
    s.on('newOrder', () => { leaked = true; });
    const r = await request(app).post('/api/orders').set('Authorization', `Bearer ${adminTok}`)
      .send({ items: [{ productId, name: 'SK Brew', price: 100, quantity: 1 }], table: 'Takeout', paymentMethod: 'Cash' });
    expect(r.status).toBe(200);
    await new Promise((res) => setTimeout(res, 800));
    expect(leaked).toBe(false);
    s.close();
  });

  it('a finance user gets ledger updates (the room follows accounting.view, not the admin role)', async () => {
    const s = await connect({ auth: { token: financeTok } });
    const got = new Promise((resolve) => s.once('erpUpdated', resolve));
    // A manual journal entry fires emitToMgr('erpUpdated'). Finance does not
    // approve its own entries, so this one is saved for approval (202) - that
    // refreshes the ledger screens too.
    const r = await request(app).post('/api/journal').set('Authorization', `Bearer ${financeTok}`).send({
      description: 'socket probe', lines: [
        { accountCode: '111000', accountName: 'Cash on Hand', debit: 10, credit: 0 },
        { accountCode: '310000', accountName: "Owner's Capital", debit: 0, credit: 10 },
      ],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(202);
    const evt = await Promise.race([got, new Promise((_, rej) => setTimeout(() => rej(new Error('finance got no ledger update')), 5000))]);
    expect(evt).toBeDefined();
    s.close();
  });

  it('an anonymous device connects (no room membership) and the client stubs are no-ops', async () => {
    const s = await connect(); // no token
    s.emit('joinRoom', 'manager');        // anti-spoof no-op
    s.emit('updateOrderStatus', { x: 1 }); // stub no-op
    await new Promise((r) => setTimeout(r, 150));
    expect(s.connected).toBe(true);
    s.close();
  });

  it('an invalid token is treated as anonymous (handshake does not refuse the connection)', async () => {
    const s = await connect({ auth: { token: 'not.a.valid.jwt' } });
    expect(s.connected).toBe(true);
    s.close();
  });
});
