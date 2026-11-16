// A client reached on a host missing from ALLOWED_ORIGINS could not sign in
// ("CORS blocked"). The app's own address is always allowed now; other sites
// still are not.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { bootApp, makeUser } from './helpers/harness.js';

let ctx, app;
beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'CorsOwner', role: 'superadmin', password: 'pw-cors-1234' });
}, 120000);
afterAll(async () => { await ctx.stop(); });

const signIn = (origin, host) => request(app).post('/api/users/login')
  .set('Origin', origin).set('Host', host)
  .send({ name: 'CorsOwner', password: 'pw-cors-1234' });

describe('who may call the API from a browser', () => {
  it("lets in a page served on the server's own address, though it is not on the list", async () => {
    const r = await signIn('https://infu-main-bar.app.semivra.asia', 'infu-main-bar.app.semivra.asia');
    expect(r.status, JSON.stringify(r.body)).not.toBe(403);
    expect(r.status).toBeLessThan(500);
    expect(r.headers['access-control-allow-origin']).toBe('https://infu-main-bar.app.semivra.asia');
  });

  it('still blocks another site, even one claiming to forward for this host', async () => {
    const r = await request(app).post('/api/users/login')
      .set('Origin', 'https://evil.example').set('Host', 'infu-main-bar.app.semivra.asia')
      .set('X-Forwarded-Host', 'evil.example')
      .send({ name: 'CorsOwner', password: 'pw-cors-1234' });
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
    expect(r.status).toBeGreaterThanOrEqual(400);
  });
});
