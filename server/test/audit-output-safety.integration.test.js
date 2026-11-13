// Regression tests for the 2026-11 audit's output and outbound-address
// findings (M08, M10, M29, M30, M31, M58).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';
import { csvCell } from '../lib/csv.js';
import { isInternalHost, isInternalUrl } from '../lib/netGuard.js';

let ctx, app, superTok, adminTok;
const M = (n) => mongoose.model(n);
const auth = (m, p, t) => request(app)[m](p).set('Authorization', `Bearer ${t}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log', jwtSecret: 'audit-output-safety-secret-0123456789' });
  app = ctx.app;
  await makeUser({ name: 'OsSuper', role: 'superadmin' });
  await makeUser({ name: 'OsAdmin', role: 'admin' });
  superTok = await loginStaff(app, 'OsSuper');
  adminTok = await loginStaff(app, 'OsAdmin');
}, 120000);

afterAll(async () => { await ctx.stop(); });

describe('the mail account (M08, M29)', () => {
  it('cannot be rewritten through the generic settings endpoint', async () => {
    const r = await auth('patch', '/api/settings/mailAccount', adminTok).send({ value: { host: 'evil.example.com', port: 25, passSealed: 'x' } });
    expect(r.status).toBe(403);
  });
  it('a settings listing never carries the sealed password', async () => {
    await M('Settings').create({ key: 'mailAccount', value: { host: 'smtp.gmail.com', port: 587, user: 'a@b.c', from: 'a@b.c', passSealed: 'SEALED-SECRET' } });
    const r = await auth('get', '/api/settings', adminTok);
    expect(JSON.stringify(r.body)).not.toContain('SEALED-SECRET');
    expect(r.body.settings.mailAccount.hasPassword).toBe(true);
  });
  it('an internal mail host is refused, and a new host needs the password again', async () => {
    const internal = await auth('put', '/api/mail/account', superTok).send({ host: '127.0.0.1', port: 25, user: '', from: 'a@b.co' });
    expect(internal.status).toBe(400);
    const moved = await auth('put', '/api/mail/account', superTok).send({ host: 'smtp.other-provider.com', port: 587, user: 'a@b.c', from: 'a@b.co' });
    expect(moved.status).toBe(400);
  });
});

describe('branding settings (M10)', () => {
  it('only a real size, colour or image is stored', async () => {
    expect((await auth('patch', '/api/settings/logoRadius', adminTok).send({ value: '8px;}</style><script>alert(1)</script>' })).status).toBe(400);
    expect((await auth('patch', '/api/settings/logoColor', adminTok).send({ value: 'red;background:url(javascript:alert(1))' })).status).toBe(400);
    expect((await auth('patch', '/api/settings/businessLogo', adminTok).send({ value: 'x" onerror="alert(1)' })).status).toBe(400);
    expect((await auth('patch', '/api/settings/portalSupportLink', adminTok).send({ value: 'javascript:alert(1)' })).status).toBe(400);
    expect((await auth('patch', '/api/settings/logoRadius', adminTok).send({ value: '12px' })).status).toBe(200);
    expect((await auth('patch', '/api/settings/logoColor', adminTok).send({ value: '#ffc107' })).status).toBe(200);
  });
});

describe('CSV exports (M31)', () => {
  it('a text cell that starts like a formula is exported as text', () => {
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe('"\'=HYPERLINK(""http://x"",""y"")"');
    expect(csvCell('+1+1')).toBe("'+1+1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell(-12.5)).toBe('-12.5');
    expect(csvCell('plain, text')).toBe('"plain, text"');
  });
  it('the audit export neutralises a name planted by a failed sign-in', async () => {
    await request(app).post('/api/users/login').send({ name: '=HYPERLINK("http://evil","x")', password: 'nope' });
    const today = new Date().toISOString().slice(0, 10);
    const r = await auth('get', `/api/audit-logs/export?start=${today}&end=${today}`, superTok);
    expect(r.status).toBe(200);
    expect(r.text).not.toMatch(/(^|,)"?=HYPERLINK/m);
  });
});

describe('outbound addresses (M29, M30)', () => {
  it('recognises internal hosts and URLs', () => {
    for (const h of ['127.0.0.1', '10.1.2.3', '172.16.0.9', '192.168.0.1', '169.254.169.254', 'mongo', 'localhost', '::1', '2130706433']) {
      expect(isInternalHost(h), h).toBe(true);
    }
    for (const h of ['smtp.gmail.com', '8.8.8.8', 'mail.example.com']) expect(isInternalHost(h), h).toBe(false);
    expect(isInternalUrl('file:///etc/passwd')).toBe(true);
  });
  it('a linked business is called at the address its slug gives, never a stored one', async () => {
    await M('LinkedBusiness').create({ businessType: 'log', partnerSlug: 'bad slug!', partnerName: 'X', partnerUrl: 'http://169.254.169.254', linkToken: 't'.repeat(64), status: 'active', role: 'hub' });
    const r = await auth('get', '/api/hub/network-summary', superTok);
    expect(r.status).toBe(200);
    const p = (r.body.partners || []).find((x) => x.partnerName === 'X');
    expect(p.ok).toBe(false);
    expect(JSON.stringify(p)).not.toContain('169.254');
  });
});

describe('search patterns (M58)', () => {
  it('a regex in the cashier search is matched literally', async () => {
    const r = await auth('get', '/api/shifts?cashier=(a%2B)%2B%24', superTok);
    expect(r.status).toBeLessThan(500);
  });
});
