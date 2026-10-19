// Who is at the screen, on a terminal several people share.
//
// One tablet behind a bar. Signing out and back in with a password between
// drinks is friction nobody absorbs, so everything gets rung on whoever is
// still signed in, and the sale's cashier, Cashier Variance and Commissions all
// follow the wrong person without ever saying so.
//
// Identity therefore works in two tiers: the DEVICE signs in once with a real
// password, and a short PIN says who is ringing now. The PIN identifies; what
// that person may DO still comes from their role.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, ownerTok, baristaTok, product;
const as = (tok) => (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const M = (n) => mongoose.model(n);

const setPin = async (name, pin, tok = ownerTok) => {
  const u = await M('User').findOne({ name }).lean();
  return as(tok)('patch', `/api/users/${u._id}`).send({ pin });
};

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'Owner', role: 'superadmin' });
  await makeUser({ name: 'Ana', role: 'Staff' });
  await makeUser({ name: 'Ben', role: 'Staff' });
  ownerTok = await loginStaff(app, 'Owner');
  baristaTok = await loginStaff(app, 'Ana');
  await M('Category').create({ name: 'Drinks' });
  product = await M('Product').create({ name: 'Latte', category: 'Drinks', basePrice: 120 });
}, 120000);

afterAll(async () => { await ctx.stop(); });

beforeEach(async () => {
  await M('User').updateMany({}, { $set: { pinHash: '', pinFailedCount: 0, pinLockedUntil: null } });
  await M('Order').deleteMany({});
});

describe('giving someone a PIN', () => {
  it('stores it hashed and never hands it back', async () => {
    const res = await setPin('Ana', '1234');
    expect(res.body.success).toBe(true);
    expect(res.body.user.hasPin).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('1234');

    const ana = await M('User').findOne({ name: 'Ana' }).lean();
    expect(ana.pinHash).toBeTruthy();
    expect(ana.pinHash).not.toBe('1234');
  });

  it('refuses a PIN somebody else already uses', async () => {
    await setPin('Ana', '1234');
    const res = await setPin('Ben', '1234');
    // A bare PIN has to identify exactly one person, or a sale lands on
    // whichever record happened to be read first.
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already used by Ana/i);
  });

  it('refuses anything that is not 4 to 6 digits', async () => {
    for (const bad of ['12', '1234567', 'abcd', '12a4']) {
      const res = await setPin('Ana', bad);
      expect(res.status).toBe(400);
    }
  });

  it('clears the PIN when it is emptied', async () => {
    await setPin('Ana', '1234');
    const res = await setPin('Ana', '');
    expect(res.body.user.hasPin).toBe(false);
    // And she drops out of the list of people who can be switched to.
    const ops = await as(ownerTok)('get', '/api/users/operators');
    expect(ops.body.operators.map(o => o.name)).not.toContain('Ana');
  });
});

describe('handing the terminal to someone else', () => {
  beforeEach(async () => { await setPin('Ben', '4321'); });

  it('switches who the terminal is, in one step', async () => {
    const res = await as(baristaTok)('post', '/api/users/switch').send({ pin: '4321' });
    expect(res.body.success).toBe(true);
    expect(res.body.user.name).toBe('Ben');
    expect(res.body.token).toBeTruthy();
  });

  it('makes the next sale belong to the person who rang it', async () => {
    const switched = await as(baristaTok)('post', '/api/users/switch').send({ pin: '4321' });
    const benTok = switched.body.token;

    const order = await as(benTok)('post', '/api/orders').send({
      table: 'Takeout', paymentMethod: 'Cash',
      items: [{ productId: String(product._id), name: 'Latte', price: 120, quantity: 1 }],
    });
    // The whole point: Ana was signed in, Ben rang it, and it says Ben.
    const saved = await M('Order').findById(order.body.order._id).lean();
    expect(saved.cashier).toBe('Ben');
  });

  it('lets that person clock in as themselves, with no password', async () => {
    const switched = await as(baristaTok)('post', '/api/users/switch').send({ pin: '4321' });
    const res = await as(switched.body.token)('post', '/api/clock/in').send({});
    expect(res.body.success).toBe(true);
    expect(res.body.entry.staffName).toBe('Ben');
  });

  it('cannot open a terminal from cold - the device must be signed in first', async () => {
    // The PIN is the second tier, not a replacement for the password.
    const res = await request(app).post('/api/users/switch').send({ pin: '4321' });
    expect(res.status).toBe(401);
  });

  it('refuses a PIN nobody has', async () => {
    const res = await as(baristaTok)('post', '/api/users/switch').send({ pin: '9999' });
    // Refused, not "signed out": the barista's own session is still good.
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not recognised/i);
  });

  it('locks a named account after repeated wrong PINs', async () => {
    for (let i = 0; i < 5; i++) {
      await as(baristaTok)('post', '/api/users/switch').send({ name: 'Ben', pin: '0000' });
    }
    // Even the right PIN is refused while it is locked, and it says so rather
    // than leaving someone retyping a PIN that is correct. A password still works.
    const res = await as(baristaTok)('post', '/api/users/switch').send({ name: 'Ben', pin: '4321' });
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/sign in with a password/i);

    const ben = await M('User').findOne({ name: 'Ben' }).lean();
    expect(ben.pinLockedUntil).toBeTruthy();
    expect(ben.pinLockedUntil.getTime()).toBeGreaterThan(Date.now());
  });

  it('forgets the failures once the right PIN is entered', async () => {
    await as(baristaTok)('post', '/api/users/switch').send({ name: 'Ben', pin: '0000' });
    await as(baristaTok)('post', '/api/users/switch').send({ pin: '4321' });
    const ben = await M('User').findOne({ name: 'Ben' }).lean();
    expect(ben.pinFailedCount).toBe(0);
  });
});

describe('a manager approving something at the counter', () => {
  beforeEach(async () => {
    await setPin('Owner', '9876');
    await setPin('Ana', '1111');
  });

  it('approves without signing the barista out', async () => {
    const res = await as(baristaTok)('post', '/api/users/authorize')
      .send({ pin: '9876', permission: 'orders.void' });
    expect(res.body.success).toBe(true);
    expect(res.body.approver.name).toBe('Owner');
    // No token comes back: approving is not switching. The barista stays put.
    expect(res.body.token).toBeUndefined();
  });

  it('refuses when the PIN belongs to someone without that right', async () => {
    const res = await as(baristaTok)('post', '/api/users/authorize')
      .send({ pin: '1111', permission: 'orders.void' });
    // The PIN proved who she is; her role is what says no.
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Ana is not allowed/i);
  });

  it('refuses a PIN nobody has', async () => {
    const res = await as(baristaTok)('post', '/api/users/authorize').send({ pin: '5555' });
    expect(res.status).toBe(403);
  });

  it('records who approved it', async () => {
    await as(baristaTok)('post', '/api/users/authorize').send({ pin: '9876', permission: 'orders.void' });
    const log = await M('AuditLog').findOne({ action: 'User_AUTHORIZE' }).sort({ createdAt: -1 }).lean();
    expect(log).toBeTruthy();
    expect(log.details.after.approver).toBe('Owner');
    expect(log.details.after.requestedBy).toBe('Ana');
  });
});

describe('the list of people who can take the terminal', () => {
  it('shows only those with a PIN, and never the PIN itself', async () => {
    await setPin('Ben', '4321');
    const res = await as(baristaTok)('get', '/api/users/operators');

    expect(res.body.operators.map(o => o.name)).toEqual(['Ben']);
    expect(JSON.stringify(res.body)).not.toContain('4321');
    expect(JSON.stringify(res.body)).not.toContain('pinHash');
  });
});


// Locking the register after every sale. The mechanism is the same PIN switch;
// the setting only decides whether the till shuts itself between sales. It is a
// plain flag, but a flag that is read as a string would leave a shop locked out
// of its own register, so the coercion is worth pinning down.
describe('asking who is ringing after every sale', () => {
  const read = async () => {
    const res = await as(ownerTok)('get', '/api/settings');
    return res.body.settings.askOperatorEachSale;
  };

  it('is off until somebody turns it on', async () => {
    expect(await read()).toBeUndefined();
  });

  it('turns on and off, and stays a real boolean', async () => {
    await as(ownerTok)('patch', '/api/settings/askOperatorEachSale').send({ value: true });
    expect(await read()).toBe(true);
    await as(ownerTok)('patch', '/api/settings/askOperatorEachSale').send({ value: false });
    expect(await read()).toBe(false);
  });

  it('treats the string "false" as off', async () => {
    // A form posts strings, and "false" is truthy in JavaScript. Left uncoerced
    // this would lock a register the owner had just switched off.
    await as(ownerTok)('patch', '/api/settings/askOperatorEachSale').send({ value: 'false' });
    expect(await read()).toBe(false);
  });

  it('is not something a barista can change', async () => {
    const res = await as(baristaTok)('patch', '/api/settings/askOperatorEachSale').send({ value: true });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

// A four digit code behind a hash is seconds of offline guessing, so the hash
// must never reach a till. Every route that hands back a user is checked,
// because one that forgets hands over every operator identity in the shop.
describe('the PIN hash never leaves the server', () => {
  beforeEach(async () => { await setPin('Ana', '1234'); });

  it('is absent from the staff list, which every till loads', async () => {
    const res = await as(baristaTok)('get', '/api/users');
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('pinHash');
    expect(body).not.toContain('$2b$');      // no bcrypt hash of any kind
    // The screen still learns what it needs: whether a PIN exists.
    expect(res.body.users.find(u => u.name === 'Ana').hasPin).toBe(true);
    expect(res.body.users.find(u => u.name === 'Ben').hasPin).toBe(false);
  });

  it('is absent when a staff record is saved', async () => {
    const ana = await M('User').findOne({ name: 'Ana' }).lean();
    const res = await as(ownerTok)('patch', `/api/users/${ana._id}`).send({ name: 'Ana' });
    expect(JSON.stringify(res.body)).not.toContain('pinHash');
  });

  it('is absent from the operator list the keypad shows', async () => {
    const res = await as(baristaTok)('get', '/api/users/operators');
    expect(JSON.stringify(res.body)).not.toContain('$2b$');
  });
});
