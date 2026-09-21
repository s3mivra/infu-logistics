// The two protections every route now gets (lib/requestSafety.js).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import { stripQueryOperators, forwardAsyncErrors } from '../lib/requestSafety.js';
import { bootApp } from './helpers/harness.js';

describe('an async route that throws', () => {
  // Express 4 ignores the promise an async handler returns, and this server
  // exits on an unhandled rejection. One thrown error in one route used to
  // take every till down with it.
  const app = forwardAsyncErrors(express());
  app.get('/boom', async () => { throw new Error('database hiccup'); });
  app.get('/sync-boom', () => { throw new Error('sync'); });
  app.get('/fine', async (req, res) => res.json({ ok: true }));
  app.use((err, req, res, _next) => res.status(500).json({ error: err.message }));

  it('answers 500 through the error middleware', async () => {
    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('database hiccup');
  });

  it('does the same for a plain function', async () => {
    expect((await request(app).get('/sync-boom')).status).toBe(500);
  });

  it('leaves a working route alone, and still reads settings', async () => {
    expect((await request(app).get('/fine')).body.ok).toBe(true);
    app.set('answer', 42);
    expect(app.get('answer')).toBe(42);
  });
});

describe('query operators from the outside', () => {
  const app = express();
  app.use(express.json());
  app.use(stripQueryOperators);
  app.post('/echo', (req, res) => res.json({ body: req.body, query: req.query }));

  it('are removed from bodies and query strings, at any depth', async () => {
    const res = await request(app).post('/echo?name[$ne]=x&plain=1')
      .send({ code: { $ne: null }, nested: [{ a: 1, $where: 'x' }], keep: 'yes' });
    expect(res.body.body).toEqual({ code: {}, nested: [{ a: 1 }], keep: 'yes' });
    expect(res.body.query).toEqual({ name: {}, plain: '1' });
  });
});

describe('the hub handshake', () => {
  // Unauthenticated by design - the invite code is the secret. With no
  // sanitising, `code: { $ne: null }` matched any open invite, so an outsider
  // could link their own server and then call the link-token routes.
  let ctx, app;
  beforeAll(async () => {
    ctx = await bootApp({ businessType: 'log' });
    app = ctx.app;
  }, 120000);
  afterAll(async () => { await ctx.stop(); });

  it('cannot be redeemed without the real code', async () => {
    const HubInvite = mongoose.model('HubInvite');
    const LinkedBusiness = mongoose.model('LinkedBusiness');
    await HubInvite.create({ businessType: 'log', code: 'REAL-CODE-123', expiresAt: new Date(Date.now() + 3600e3) });

    const res = await request(app).post('/api/hub/internal/handshake')
      .send({ code: { $ne: null }, clientSlug: 'intruder', clientUrl: 'https://evil.example', linkToken: 'attacker-token' });
    expect(res.status).toBe(400);
    expect(await LinkedBusiness.findOne({ partnerSlug: 'intruder' })).toBeNull();
    expect((await HubInvite.findOne({ code: 'REAL-CODE-123' }).lean()).usedAt).toBeFalsy();
  });
});
