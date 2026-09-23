// A Google Sheet linked to Inventory: saved, checked for changes, pulled -
// all of its tabs, or only the ones chosen.
//
// The check must only ever LOOK - flag a change in the bell - and never touch
// stock, because an import is a stock count and a timed one would undo every
// sale made since the sheet was edited. Google is mocked; only its hosts may
// ever be contacted.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';
import { makeXlsx } from './helpers/makeXlsx.js';
import { parseSheetLink, exportUrl, localTime, isCheckDue } from '../lib/googleSheet.js';
import { workbookTabs, XlsxError } from '../lib/xlsxTabs.js';
import { cleanTabs } from '../features/inventory-sheet.js';

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
const LINK = `https://docs.google.com/spreadsheets/d/${ID}/edit#gid=42`;
const XLSX_URL = `https://docs.google.com/spreadsheets/d/${ID}/export?format=xlsx`;

// The sheet as the business keeps it: two stock tabs and a notes tab.
const baseBook = () => ({
  Beans: [['Product', 'Qty Unit', 'Unit Cost'], ['Espresso Beans 1kg', 10, 900]],
  Milk: [['Product', 'Qty Unit', 'Unit Cost'], ['Fresh Milk 1L', 24, 95]],
  Notes: [['Reminder'], ['Order cups on Friday']],
});

let ctx, app, owner, manager, sheet, calls;
const as = (tok) => (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const save = (body, tok = owner) => as(tok)('put', '/api/inventory-sheet').send(body);
const check = () => as(owner)('post', '/api/inventory-sheet/check');
const bell = async () => (await as(owner)('get', '/api/notifications')).body.items.filter((i) => i.id.startsWith('sheet:'));

// Google, as far as this server can tell.
const google = (url) => {
  calls.push(url);
  if (sheet.respond) return sheet.respond(url);
  return new Response(makeXlsx(sheet.book), { headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } });
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
  await mongoose.model('Settings').deleteMany({ key: { $in: ['inventorySheet', 'setupSheet'] } });
  sheet = { book: baseBook() };
  calls = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => google(String(url)));
});
afterEach(() => { vi.restoreAllMocks(); });

describe('the link', () => {
  it('reads the sheet once on save, watching all tabs unless told otherwise', async () => {
    const res = await save({ url: LINK, checkTime: '06:00' });
    expect(res.body.success).toBe(true);
    expect(res.body.sheet).toMatchObject({ url: LINK, checkTime: '06:00', tabs: 'all', availableTabs: ['Beans', 'Milk', 'Notes'], changedAt: null });
    expect(calls).toEqual([XLSX_URL]);
    expect(res.body.sheet).not.toHaveProperty('seenHash');
  });

  it('lists the tabs of a link before it is saved', async () => {
    const res = await as(owner)('post', '/api/inventory-sheet/tabs').send({ url: LINK });
    expect(res.body).toMatchObject({ success: true, tabs: ['Beans', 'Milk', 'Notes'] });
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

  it('says so when Google sends something that is not a spreadsheet', async () => {
    sheet.respond = () => new Response('Product,Qty\nBeans,1\n', { headers: { 'content-type': 'application/octet-stream' } });
    const res = await save({ url: LINK });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/could not be read as a spreadsheet/i);
  });

  it('rejects a check time that is not a time of day, and a malformed tab choice', async () => {
    expect((await save({ url: LINK, checkTime: '25:00' })).status).toBe(400);
    expect((await save({ url: LINK, tabs: [] })).status).toBe(400);
    expect((await save({ url: LINK, tabs: 'Beans' })).status).toBe(400);
  });

  it('is superadmin-only, like the stock import itself', async () => {
    expect((await save({ url: LINK }, manager)).status).toBe(403);
    expect((await as(manager)('post', '/api/inventory-sheet/pull')).status).toBe(403);
    expect((await as(manager)('post', '/api/inventory-sheet/tabs').send({ url: LINK })).status).toBe(403);
  });
});

describe('choosing tabs', () => {
  it('watches only the chosen tabs: a notes tab changing is not a stock change', async () => {
    await save({ url: LINK, tabs: ['Beans', 'Milk'] });
    sheet.book.Notes[1][0] = 'Order lids too';
    expect((await check()).body.changed).toBe(false);

    sheet.book.Milk[1][1] = 18;
    expect((await check()).body.changed).toBe(true);
    expect((await bell()).map((i) => i.id)).toEqual(['sheet:changed:inventory']);
  });

  it('notices a changed word, not only a changed number', async () => {
    await save({ url: LINK, tabs: ['Beans'] });
    sheet.book.Beans[1][0] = 'Espresso Beans 500g';
    expect((await check()).body.changed).toBe(true);
  });

  it('with all tabs, any tab changing counts', async () => {
    await save({ url: LINK });
    sheet.book.Notes[1][0] = 'Order lids too';
    expect((await check()).body.changed).toBe(true);
  });

  it('refuses to save a tab that is not in the sheet', async () => {
    const res = await save({ url: LINK, tabs: ['Beans', 'Dairy'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/"Dairy" is not in the sheet/);
  });

  it('reports a chosen tab that was renamed, instead of calling it unchanged', async () => {
    await save({ url: LINK, tabs: ['Milk'] });
    sheet.book = { Beans: sheet.book.Beans, Dairy: sheet.book.Milk, Notes: sheet.book.Notes };
    const res = await check();
    expect(res.body.error).toMatch(/"Milk" is not in the sheet any more/);
    expect((await bell()).map((i) => i.id)).toEqual(['sheet:error:inventory']);
    // Choosing again fixes it.
    expect((await save({ url: LINK, tabs: ['Dairy'] })).body.sheet.tabs).toEqual(['Dairy']);
    expect((await check()).body.error).toBeUndefined();
  });

  it('re-bases quietly when the tab choice changes', async () => {
    await save({ url: LINK, tabs: ['Beans'] });
    sheet.book.Milk[1][1] = 1;
    await save({ url: LINK, tabs: ['Beans', 'Milk'] });
    expect((await check()).body.changed).toBe(false);
  });

  it('re-bases a link saved before tabs existed, rather than calling it a change', async () => {
    await mongoose.model('Settings').create({ key: 'inventorySheet', value: { url: LINK, seenHash: 'an-old-csv-fingerprint', checkTime: '06:00' } });
    expect((await check()).body.changed).toBe(false);
    expect(await bell()).toEqual([]);
    sheet.book.Beans[1][1] = 3;
    expect((await check()).body.changed).toBe(true);
  });
});

describe('the check', () => {
  it('applies nothing', async () => {
    await save({ url: LINK });
    const before = await mongoose.model('Inventory').countDocuments();
    sheet.book.Beans[1][1] = 4;
    expect((await check()).body.changed).toBe(true);
    expect(await mongoose.model('Inventory').countDocuments()).toBe(before);
  });

  it('shows in the bell why a check failed', async () => {
    await save({ url: LINK });
    sheet.respond = () => new Response('gone', { status: 404 });
    await check();
    const items = await bell();
    expect(items.map((i) => i.id)).toEqual(['sheet:error:inventory']);
    expect(items[0].detail).toMatch(/not found/i);
  });

  it('is not shown to anyone who cannot import stock', async () => {
    await save({ url: LINK });
    sheet.book.Beans[1][1] = 4;
    await check();
    const mgrItems = (await as(manager)('get', '/api/notifications')).body.items || [];
    expect(mgrItems.filter((i) => i.id.startsWith('sheet:'))).toEqual([]);
  });
});

describe('pulling', () => {
  it('hands the workbook to the browser and clears the change', async () => {
    await save({ url: LINK, tabs: ['Beans'] });
    sheet.book.Beans[1][1] = 4;
    await check();

    const res = await as(owner)('post', '/api/inventory-sheet/pull').buffer(true).parse((r, cb) => {
      const chunks = []; r.on('data', (c) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml/);
    expect(workbookTabs(res.body).map((t) => t.name)).toEqual(['Beans', 'Milk', 'Notes']);

    expect(await bell()).toEqual([]);
    expect((await check()).body.changed).toBe(false);
    expect((await as(owner)('get', '/api/inventory-sheet')).body.sheet.lastPulledAt).toBeTruthy();
  });

  it('explains when no sheet is linked', async () => {
    const res = await as(owner)('post', '/api/inventory-sheet/pull');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no stock sheet is linked/i);
  });
});

describe('the setup workbook, linked from Settings', () => {
  const SETUP = '/api/setup-sheet';

  it('is linked and checked the same way, and kept apart from the stock sheet', async () => {
    await save({ url: LINK, tabs: ['Beans'] });
    const setup = await as(owner)('put', SETUP).send({ url: LINK, tabs: ['Milk'] });
    expect(setup.body.sheet).toMatchObject({ url: LINK, tabs: ['Milk'] });

    // A change in Milk is the setup workbook's business, not the stock sheet's.
    sheet.book.Milk[1][1] = 18;
    expect((await as(owner)('post', `${SETUP}/check`)).body.changed).toBe(true);
    expect((await check()).body.changed).toBe(false);
    expect((await bell()).map((i) => i.id)).toEqual(['sheet:changed:setup']);

    // Unlinking one leaves the other alone.
    await as(owner)('put', SETUP).send({ url: '' });
    expect((await as(owner)('get', SETUP)).body.sheet.url).toBe('');
    expect((await as(owner)('get', '/api/inventory-sheet')).body.sheet.url).toBe(LINK);
  });

  it('hands over the workbook to import, and is superadmin-only', async () => {
    await as(owner)('put', SETUP).send({ url: LINK });
    const res = await as(owner)('post', `${SETUP}/pull`).buffer(true).parse((r, cb) => {
      const chunks = []; r.on('data', (c) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(workbookTabs(res.body).map((t) => t.name)).toEqual(['Beans', 'Milk', 'Notes']);
    expect((await as(manager)('post', `${SETUP}/pull`)).status).toBe(403);
  });
});

describe('reading a workbook', () => {
  it('lists tabs in order, and fingerprints each on its own', () => {
    const a = workbookTabs(makeXlsx(baseBook()));
    const book = baseBook(); book.Notes[1][0] = 'changed';
    const b = workbookTabs(makeXlsx(book));
    expect(a.map((t) => t.name)).toEqual(['Beans', 'Milk', 'Notes']);
    expect(b[0].fingerprint).toBe(a[0].fingerprint);
    expect(b[2].fingerprint).not.toBe(a[2].fingerprint);
  });

  it('refuses what is not an .xlsx', () => {
    expect(() => workbookTabs(Buffer.from('not a zip at all, just text'))).toThrow(XlsxError);
  });

  it('keeps a tab choice to real names', () => {
    expect(cleanTabs(undefined)).toBe('all');
    expect(cleanTabs('all')).toBe('all');
    expect(cleanTabs([' Beans ', 'Beans', 'Milk'])).toEqual(['Beans', 'Milk']);
    expect(cleanTabs([])).toBeNull();
    expect(cleanTabs('Beans')).toBeNull();
    expect(cleanTabs(Array.from({ length: 51 }, (_, i) => `T${i}`))).toBeNull();
  });
});

describe('link parsing', () => {
  it('understands shared and published links', () => {
    expect(parseSheetLink(`https://docs.google.com/spreadsheets/d/${ID}/edit?gid=7#gid=7`)).toEqual({ kind: 'id', id: ID, gid: '7' });
    expect(parseSheetLink(`https://docs.google.com/spreadsheets/d/e/2PACX-${ID}/pubhtml`)).toEqual({ kind: 'pub', id: `2PACX-${ID}`, gid: '' });
    expect(exportUrl({ kind: 'pub', id: 'P', gid: '3' }, 'xlsx')).toBe('https://docs.google.com/spreadsheets/d/e/P/pub?output=xlsx');
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
