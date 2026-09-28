// `users.manage` used to be a lie: the permissions UI offered it as a tick box
// while every /api/users mutation was guarded by requireSuperAdmin alone, so
// granting it changed nothing. It is honoured now - but managing staff is the
// one permission that can mint every other permission, so it carries escalation
// limits a superadmin does not need.
//
// These tests are mostly about the limits. A delegate who can run the roster
// and also quietly promote themselves is not a delegate, it is a second owner.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, superTok, delegateTok, delegateId;
const as = (tok, m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;

  await makeUser({ name: 'Owner', role: 'superadmin' });
  superTok = await loginStaff(app, 'Owner');

  // A deliberately NARROW delegate: exactly what a plain Staff account gets,
  // plus the right to run staff. They can create Staff; nothing above that.
  await makeUser({
    name: 'Delegate', role: 'manager',
    permissions: ['users.manage', 'pos.use', 'orders.view', 'orders.comp', 'inventory.view', 'inventory.waste', 'inventory.count', 'products.view'],
  });
  // makeUser returns the NAME, not the document.
  delegateId = String((await mongoose.model('User').findOne({ name: 'Delegate' }).lean())._id);
  delegateTok = await loginStaff(app, 'Delegate');
}, 120000);

afterAll(async () => { await ctx?.stop?.(); });

describe('users.manage actually grants staff administration', () => {
  it('lets a non-superadmin holding it create a staff account', async () => {
    const r = await as(delegateTok, 'post', '/api/users')
      .send({ name: 'Newbie', password: 'pw12345', role: 'staff' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.user.name).toBe('Newbie');
  });

  it('refuses a staff member who does NOT hold it', async () => {
    await makeUser({ name: 'Plain', role: 'cashier' });
    const tok = await loginStaff(app, 'Plain');
    const r = await as(tok, 'post', '/api/users')
      .send({ name: 'Nope', password: 'pw12345', role: 'staff' });
    expect(r.status).toBe(403);
    // And it really did not happen - a 403 that still wrote would be worse
    // than no check at all.
    expect(await mongoose.model('User').countDocuments({ name: 'Nope' })).toBe(0);
  });
});

describe('the escalation limits on users.manage', () => {
  it('will not let a delegate mint a superadmin', async () => {
    const r = await as(delegateTok, 'post', '/api/users')
      .send({ name: 'Usurper', password: 'pw12345', role: 'superadmin' });
    expect(r.status).toBe(403);
    expect(await mongoose.model('User').countDocuments({ name: 'Usurper' })).toBe(0);
  });

  it('will not let a delegate grant a permission they do not hold', async () => {
    const r = await as(delegateTok, 'post', '/api/users')
      .send({ name: 'Bookkeeper', password: 'pw12345', role: 'staff',
              permissions: ['accounting.manage'] });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/accounting\.manage/);
    expect(await mongoose.model('User').countDocuments({ name: 'Bookkeeper' })).toBe(0);
  });

  it('lets a delegate grant a permission they DO hold', async () => {
    const r = await as(delegateTok, 'post', '/api/users')
      .send({ name: 'Viewer', password: 'pw12345', role: 'staff',
              permissions: ['orders.view'] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });

  it('will not let a delegate touch a superadmin account', async () => {
    const owner = await mongoose.model('User').findOne({ name: 'Owner' }).lean();
    const r = await as(delegateTok, 'put', `/api/users/${owner._id}`)
      .send({ name: 'Owner', password: 'hijacked123' });
    expect(r.status).toBe(403);
  });

  it('will not let a delegate widen their own permissions', async () => {
    const r = await as(delegateTok, 'patch', `/api/users/${delegateId}`)
      .send({ permissions: ['users.manage', 'pos.use', 'orders.view', 'inventory.view', 'products.view', 'accounting.manage'] });
    expect(r.status).toBe(403);
    const me = await mongoose.model('User').findById(delegateId).lean();
    expect(me.permissions).not.toContain('accounting.manage');
  });

  it('will not let a delegate promote themselves by role', async () => {
    const r = await as(delegateTok, 'patch', `/api/users/${delegateId}`)
      .send({ role: 'superadmin' });
    expect(r.status).toBe(403);
    const me = await mongoose.model('User').findById(delegateId).lean();
    expect(me.role).toBe('manager');
  });

  it('judges the delegate by their own permissions, not their role defaults', async () => {
    // A manager's role defaults include inventory.manage. This delegate was
    // explicitly given only users.manage + orders.view, so they must not be
    // able to hand inventory.manage to someone else.
    const r = await as(delegateTok, 'post', '/api/users')
      .send({ name: 'Stocker', password: 'pw12345', role: 'staff',
              permissions: ['inventory.manage'] });
    expect(r.status).toBe(403);
    expect(await mongoose.model('User').countDocuments({ name: 'Stocker' })).toBe(0);
  });

  it('will not let a delegate create a role whose DEFAULTS exceed their own', async () => {
    // No permissions ticked - the account would inherit the Admin role's
    // defaults, which include things this delegate does not hold.
    const r = await as(delegateTok, 'post', '/api/users')
      .send({ name: 'ShadowAdmin', password: 'pw12345', role: 'Admin' });
    expect(r.status).toBe(403);
    expect(await mongoose.model('User').countDocuments({ name: 'ShadowAdmin' })).toBe(0);
  });

  it('will not let a delegate raise an existing account to such a role', async () => {
    const u = await mongoose.model('User').findOne({ name: 'Viewer' }).lean();
    const r = await as(delegateTok, 'patch', `/api/users/${u._id}`).send({ role: 'Admin', permissions: [] });
    expect(r.status).toBe(403);
    expect((await mongoose.model('User').findById(u._id).lean()).role).not.toBe('Admin');
  });

  it('still lets a superadmin do all of it', async () => {
    const r = await as(superTok, 'post', '/api/users')
      .send({ name: 'SecondOwner', password: 'pw12345', role: 'superadmin',
              permissions: ['accounting.manage'] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });
});
