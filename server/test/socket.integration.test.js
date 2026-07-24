// Socket.io real-time layer: handshake JWT verification, server-decided room placement,
// the no-op client stubs, and a live broadcast reaching a subscribed device. Needs the
// http.Server listening on a real port (guarded off in test mode, so we listen manually).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { io as ioClient } from 'socket.io-client';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, server, port, adminTok, productId;

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
