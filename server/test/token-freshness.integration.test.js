// A permission change must bite immediately. Access tokens live 15 minutes and
// carry the permission set, so a demoted user used to keep the old powers
// until theirs expired. Each user now has a tokenVersion, bumped on every
// privilege change; a token minted before the bump is refused (401), and the
// client's silent refresh returns one with the new permissions.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, bossTok;
const as = (tok, m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'Boss', role: 'superadmin' });
  bossTok = await loginStaff(app, 'Boss');
}, 120000);
afterAll(async () => { await ctx?.stop?.(); });

describe('a changed permission takes effect at once', () => {
  it("refuses the demoted user's existing token on the very next request", async () => {
    await makeUser({ name: 'Lead', role: 'admin' });
    const leadTok = await loginStaff(app, 'Lead');
    expect((await as(leadTok, 'get', '/api/users/me')).status).toBe(200);

    const lead = await mongoose.model('User').findOne({ name: 'Lead' }).lean();
    const demote = await as(bossTok, 'patch', `/api/users/${lead._id}`).send({ role: 'staff' });
    expect(demote.status, JSON.stringify(demote.body)).toBe(200);

    const after = await as(leadTok, 'get', '/api/users/me');
    expect(after.status).toBe(401);
  });

  it('issues a working token with the NEW permissions on a fresh login', async () => {
    const tok = await loginStaff(app, 'Lead');
    const me = await as(tok, 'get', '/api/users/me');
    expect(me.status).toBe(200);
    expect(me.body.user.role).toBe('staff');
    // admin could create products; staff cannot.
    expect((await as(tok, 'post', '/api/products').send({ name: 'X', category: 'C', basePrice: 1 })).status).toBe(403);
  });

  it('keeps someone signed in on the device where they changed their own password', async () => {
    await makeUser({ name: 'Self', role: 'staff', password: 'oldpassword' });
    const tok = await loginStaff(app, 'Self', 'oldpassword');
    const r = await as(tok, 'patch', '/api/users/me/password').send({ currentPassword: 'oldpassword', newPassword: 'newpassword1' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.token).toBeTruthy();
    expect((await as(r.body.token, 'get', '/api/users/me')).status).toBe(200);
    expect((await as(tok, 'get', '/api/users/me')).status).toBe(401);   // the old one is dead
  });

  it("ends a deleted user's token", async () => {
    await makeUser({ name: 'Gone', role: 'staff' });
    const tok = await loginStaff(app, 'Gone');
    const u = await mongoose.model('User').findOne({ name: 'Gone' }).lean();
    await as(bossTok, 'delete', `/api/users/${u._id}`);
    expect((await as(tok, 'get', '/api/orders')).status).toBe(401);
  });
});
