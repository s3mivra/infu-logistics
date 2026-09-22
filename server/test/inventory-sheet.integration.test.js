// A Google Sheet linked to Inventory: saved, checked for changes, pulled.
//
// The check must only ever LOOK - flag a change in the bell - and never touch
// stock, because an import is a stock count and a timed one would undo every
// sale made since the sheet was edited. Google is mocked; only its hosts may
// ever be contacted.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';
import { parseSheetLink, exportUrl, localTime, isCheckDue } from '../lib/googleSheet.js';

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
const LINK = `https://docs.google.com/spreadsheets/d/${ID}/edit#gid=42`;
const XLSX_BYTES = Buffer.from('PK pretend workbook');

let ctx, app, owner, manager, sheet, calls;
const as = (tok) => (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const save = (body, tok = owner) => as(tok)('put', '/api/inventory-sheet').send(body);
const bell = async () => (await as(owner)('get', '/api/notifications')).body.items.filter((i) => i.id.startsWith('sheet:'));

// Google, as far as this server can tell: csv for the tab, xlsx for the book.
const google = (url) => {
  calls.push(url);
  if (sheet.respond) return sheet.respond(url);
  if (url.includes('format=xlsx')) return new Response(XLSX_BYTES, { headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } });
  return new Response(sheet.csv, { headers: { 'content-type': 'text/csv' } });
};

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'SheetOwner', role: 'superadmin' });
  await makeUser({ name: 'SheetMgr', role: 'manager' });
  owner = await loginStaff(app, 'SheetOwner');
  manager = await loginStaff(app, 'SheetMgr');
}, 120000);
afterAll(async () => { await ctx.stop(); });
beforeEach(async () => {
  await mongoose.model('Settings').deleteMany({ key: 'inventorySheet' });
  sheet = { csv: 'Product,Qty\nBeans,10\n' };
  calls = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => google(String(url)));
});
afterEach(() => { vi.restoreAllMocks(); });

describe('the link', () => {
  it('reads the sheet once on save and reports it unchanged', async () => {
    const res = await save({ url: LINK, checkTime: '06:00' });
    expect(res.body.success).toBe(true);
    expect(res.body.sheet).toMatchObject({ url: LINK, checkTime: '06:00', changedAt: null });
    expect(calls).toEqual([`https://docs.google.com/spreadsheets/d/${ID}/export?format=csv&gid=42`]);
    expect(res.body.sheet).not.toHaveProperty('seenHash');
  });

  it('says plainly when the sheet is not shared', async () => {
    sheet.respond = () => new Response('<html>Sign in</html>', { headers: { 'content-type': 'text/html' } });
    const res = await save({ url: LINK });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not shared/i);
  });

  it('treats a redirect to Google sign-in as not shared', async () => {
    sheet.respond = () => new Response(null, { status: 302, headers: { location: 'https://accounts.google.com/ServiceLogin' } });
    expect((await save({ url: LINK })).body.error).toMatch(/not shared/i);
  });

  it('never follows a redirect away from Google', async () => {
    sheet.respond = (url) => url.includes('docs.google.com')
      ? new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } })
      : new Response('secret');
    const res = await save({ url: LINK });
    expect(res.status).toBe(400);
    expect(calls.some((u) => u.includes('169.254'))).toBe(false);
  });

  it('refuses anything that is not a Google Sheets link, without fetching it', async () => {
    for (const url of ['https://evil.example/spreadsheets/d/x', 'http://docs.google.com/spreadsheets/d/' + ID, 'https://docs.google.com/document/d/' + ID]) {
      expect((await save({ url })).status).toBe(400);
    }
    expect(calls).toEqual([]);
  });

  it('rejects a check time that is not a time of day', async () => {
    expect((await save({ url: LINK, checkTime: '25:00' })).status).toBe(400);
  });

  it('is superadmin-only, like the stock import itself', async () => {
    expect((await save({ url: LINK }, manager)).status).toBe(403);
    expect((await as(manager)('post', '/api/inventory-sheet/pull')).status).toBe(403);
  });
});

describe('the check', () => {
  it('flags a change in the bell, and applies nothing', async () => {
    await save({ url: LINK });
    const inventoryBefore = await mongoose.model('Inventory').countDocuments();

    let res = await as(owner)('post', '/api/inventory-sheet/check');
    expect(res.body.changed).toBe(false);
    expect(await bell()).toEqual([]);

    sheet.csv = 'Product,Qty\nBeans,4\n';
    res = await as(owner)('post', '/api/inventory-sheet/check');
    expect(res.body.changed).toBe(true);
    expect(res.body.sheet.changedAt).toBeTruthy();
    expect((await bell()).map((i) => i.id)).toEqual(['sheet:changed']);
    expect(await mongoose.model('Inventory').countDocuments()).toBe(inventoryBefore);
  });

  it('shows in the bell why a check failed', async () => {
    await save({ url: LINK });
    sheet.respond = () => new Response('gone', { status: 404 });
    await as(owner)('post', '/api/inventory-sheet/check');
    const items = await bell();
    expect(items.map((i) => i.id)).toEqual(['sheet:error']);
    expect(items[0].detail).toMatch(/not found/i);
  });

  it('is not shown to anyone who cannot import stock', async () => {
    await save({ url: LINK });
    sheet.csv = 'changed';
    await as(owner)('post', '/api/inventory-sheet/check');
    const mgrItems = (await as(manager)('get', '/api/notifications')).body.items || [];
    expect(mgrItems.filter((i) => i.id.startsWith('sheet:'))).toEqual([]);
  });
});

describe('pulling', () => {
  it('hands the workbook to the browser and clears the change', async () => {
    await save({ url: LINK });
    sheet.csv = 'Product,Qty\nBeans,4\n';
    await as(owner)('post', '/api/inventory-sheet/check');

    const res = await as(owner)('post', '/api/inventory-sheet/pull').buffer(true).parse((r, cb) => {
      const chunks = []; r.on('data', (c) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml/);
    expect(Buffer.compare(res.body, XLSX_BYTES)).toBe(0);
    expect(calls).toContain(`https://docs.google.com/spreadsheets/d/${ID}/export?format=xlsx`);

    expect(await bell()).toEqual([]);
    const again = await as(owner)('post', '/api/inventory-sheet/check');
    expect(again.body.changed).toBe(false);
    expect((await as(owner)('get', '/api/inventory-sheet')).body.sheet.lastPulledAt).toBeTruthy();
  });

  it('explains when no sheet is linked', async () => {
    const res = await as(owner)('post', '/api/inventory-sheet/pull');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no sheet/i);
  });
});

describe('link parsing', () => {
  it('understands shared and published links', () => {
    expect(parseSheetLink(`https://docs.google.com/spreadsheets/d/${ID}/edit?gid=7#gid=7`)).toEqual({ kind: 'id', id: ID, gid: '7' });
    expect(parseSheetLink(`https://docs.google.com/spreadsheets/d/e/2PACX-${ID}/pubhtml`)).toEqual({ kind: 'pub', id: `2PACX-${ID}`, gid: '' });
    expect(exportUrl({ kind: 'pub', id: 'P', gid: '3' }, 'csv')).toBe('https://docs.google.com/spreadsheets/d/e/P/pub?output=csv&gid=3&single=true');
    expect(parseSheetLink('not a link')).toBeNull();
  });

  it('runs the daily check once, at or after its time on the business clock', () => {
    const at = (iso) => new Date(iso);
    const s = { url: LINK, checkTime: '06:00' };
    // 05:59 and 06:00 in Manila (UTC+8)
    expect(isCheckDue(s, at('2026-09-22T21:59:00Z'), 'Asia/Manila', '2026-09-23')).toBe(false);
    expect(isCheckDue(s, at('2026-09-22T22:00:00Z'), 'Asia/Manila', '2026-09-23')).toBe(true);
    // Already done today; a server that was down at 06:00 still checks at 09:00.
    expect(isCheckDue({ ...s, lastCheckDate: '2026-09-23' }, at('2026-09-23T01:00:00Z'), 'Asia/Manila', '2026-09-23')).toBe(false);
    expect(isCheckDue(s, at('2026-09-23T01:00:00Z'), 'Asia/Manila', '2026-09-23')).toBe(true);
    // No time set, or no sheet: never.
    expect(isCheckDue({ url: LINK, checkTime: '' }, at('2026-09-23T01:00:00Z'), 'Asia/Manila', '2026-09-23')).toBe(false);
    expect(isCheckDue({ checkTime: '06:00' }, at('2026-09-23T01:00:00Z'), 'Asia/Manila', '2026-09-23')).toBe(false);
  });

  it('reads the time on the business clock', () => {
    expect(localTime(new Date('2026-09-22T22:30:00Z'), 'Asia/Manila')).toBe('06:30');
  });
});
