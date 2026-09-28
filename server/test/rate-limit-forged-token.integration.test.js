// The rate limiter used jwt.decode, which does not check a signature, to pick
// the bucket - so a forged token with a new random _id on every request got a
// fresh bucket every time and was never limited. It now buckets by VERIFIED
// user, or by IP for anything it cannot verify.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { bootApp } from './helpers/harness.js';

let ctx, app;
beforeAll(async () => { ctx = await bootApp({ businessType: 'fb' }); app = ctx.app; }, 120000);
afterAll(async () => { await ctx?.stop?.(); });

describe('forged tokens share one bucket', () => {
  it('limits 31 money-action requests even though every token claims a different user', async () => {
    const statuses = [];
    for (let i = 0; i < 31; i++) {
      // Signed with the WRONG secret: well-formed, claims a unique user, not valid.
      const forged = jwt.sign({ _id: `forged-${i}-${Math.random()}` }, 'not-the-real-secret');
      const r = await request(app).post('/api/journal').set('Authorization', `Bearer ${forged}`).send({});
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 30).every(s => s !== 429)).toBe(true);
    expect(statuses[30]).toBe(429);
  });
});
