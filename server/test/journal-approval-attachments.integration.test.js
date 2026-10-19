// Manual journal entries: prepared, approved, then posted - and the documents
// behind them attached. An accountant's entry waits for an approver; an
// approver's own posts at once. Nothing Pending is in the ledger.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app;
const tok = {};
const as = (t, m, p) => request(app)[m](p).set('Authorization', `Bearer ${t}`);
const M = (n) => mongoose.model(n);
const LINES = [{ accountCode: '630000', debit: 1500, credit: 0 }, { accountCode: '111000', debit: 0, credit: 1500 }];
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'log' });
  app = ctx.app;
  await makeUser({ name: 'jaBoss', role: 'superadmin' });
  await makeUser({ name: 'jaAcct', role: 'staff', permissions: ['accounting.view', 'accounting.manage'] });
  await makeUser({ name: 'jaDir', role: 'staff', permissions: ['accounting.view', 'accounting.manage', 'journal.approve'] });
  await makeUser({ name: 'jaCashier', role: 'staff' }); // no accounting or procurement access
  for (const n of ['jaBoss', 'jaAcct', 'jaDir', 'jaCashier']) tok[n] = await loginStaff(app, n);
}, 120000);
afterAll(async () => { await ctx.stop(); });

describe('manual journal approval', () => {
  let draftId;

  it("an accountant's entry is held for approval and posts nothing", async () => {
    const before = await M('JournalEntry').countDocuments();
    const r = await as(tok.jaAcct, 'post', '/api/journal').send({ description: 'Accrue September rent', lines: LINES });
    expect(r.status).toBe(202);
    expect(r.body.pending).toBe(true);
    expect(r.body.draft).toMatchObject({ status: 'Pending', preparedBy: 'jaAcct', totalDebit: 1500 });
    draftId = r.body.draft._id;
    expect(await M('JournalEntry').countDocuments()).toBe(before);
    const list = await as(tok.jaDir, 'get', '/api/journal/drafts');
    expect(list.body.drafts.map(d => d._id)).toContain(draftId);
  });

  it('the preparer cannot approve it; an approver posts it, once', async () => {
    const self = await as(tok.jaAcct, 'post', `/api/journal/drafts/${draftId}/approve`);
    expect(self.status).toBe(403);
    const [a, b] = await Promise.all([
      as(tok.jaDir, 'post', `/api/journal/drafts/${draftId}/approve`),
      as(tok.jaBoss, 'post', `/api/journal/drafts/${draftId}/approve`),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const ok = a.status === 200 ? a : b;
    expect(ok.body.draft.status).toBe('Posted');
    const je = await M('JournalEntry').findOne({ reference: ok.body.entry.reference }).lean();
    expect(je.totalDebit).toBe(1500);
    expect(je.description).toMatch(/prepared by jaAcct, approved by/);
  });

  it("an approver's own entry posts at once", async () => {
    const r = await as(tok.jaDir, 'post', '/api/journal').send({ description: 'Correction', lines: LINES });
    expect(r.status).toBe(200);
    expect(r.body.pending).toBe(false);
    expect(r.body.entry.reference).toMatch(/^JRN/);
  });

  it('a rejection needs a reason and never posts', async () => {
    const d = await as(tok.jaAcct, 'post', '/api/journal').send({ description: 'Wrong one', lines: LINES });
    const before = await M('JournalEntry').countDocuments();
    expect((await as(tok.jaDir, 'post', `/api/journal/drafts/${d.body.draft._id}/reject`).send({})).status).toBe(400);
    const r = await as(tok.jaDir, 'post', `/api/journal/drafts/${d.body.draft._id}/reject`).send({ reason: 'Use account 640000' });
    expect(r.body.draft).toMatchObject({ status: 'Rejected', rejectionReason: 'Use account 640000' });
    expect(await M('JournalEntry').countDocuments()).toBe(before);
    expect((await as(tok.jaDir, 'post', `/api/journal/drafts/${d.body.draft._id}/approve`)).status).toBe(409);
  });

  it('bad lines are refused before they can wait for approval', async () => {
    const cases = [
      [{ accountCode: '999999', debit: 10 }, { accountCode: '111000', credit: 10 }],
      [{ accountCode: '630000', debit: 10 }, { accountCode: '111000', credit: 9 }],
      [{ accountCode: '630000', debit: -10 }, { accountCode: '111000', credit: -10 }],
      'not lines',
    ];
    for (const lines of cases) {
      expect((await as(tok.jaAcct, 'post', '/api/journal').send({ description: 'x', lines })).status).toBe(400);
    }
  });
});

describe('attachments', () => {
  let id;
  it('attaches a document to a pending journal and serves it back', async () => {
    const d = await as(tok.jaAcct, 'post', '/api/journal').send({ description: 'With receipt', lines: LINES });
    const r = await as(tok.jaAcct, 'post', '/api/attachments').send({ entity: 'ManualJournal', entityId: d.body.draft._id, filename: 'receipt.png', mime: 'image/png', dataBase64: PNG });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.attachment.data).toBeUndefined();
    id = r.body.attachment._id;
    const list = await as(tok.jaDir, 'get', `/api/attachments?entity=ManualJournal&entityId=${d.body.draft._id}`);
    expect(list.body.attachments).toHaveLength(1);
    const file = await as(tok.jaDir, 'get', `/api/attachments/${id}/file`).buffer(true).parse((res, cb) => { const c = []; res.on('data', x => c.push(x)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toMatch(/image\/png/);
    expect(file.headers['content-disposition']).toMatch(/attachment/);
    expect(Buffer.compare(file.body, Buffer.from(PNG, 'base64'))).toBe(0);
  });

  it('refuses script-capable files, oversize files and people without access', async () => {
    const base = { entity: 'Bill', entityId: 'abc123', filename: 'x' };
    expect((await as(tok.jaAcct, 'post', '/api/attachments').send({ ...base, mime: 'text/html', dataBase64: 'PGgxPg==' })).status).toBe(415);
    expect((await as(tok.jaAcct, 'post', '/api/attachments').send({ ...base, mime: 'image/svg+xml', dataBase64: 'PGgxPg==' })).status).toBe(415);
    const big = Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64');
    expect((await as(tok.jaAcct, 'post', '/api/attachments').send({ ...base, mime: 'application/pdf', dataBase64: big })).status).toBe(413);
    expect((await as(tok.jaCashier, 'post', '/api/attachments').send({ ...base, mime: 'image/png', dataBase64: PNG })).status).toBe(403);
    expect((await as(tok.jaCashier, 'get', '/api/attachments?entity=Bill&entityId=abc123')).status).toBe(403);
    expect((await as(tok.jaAcct, 'post', '/api/attachments').send({ ...base, entity: 'User', mime: 'image/png', dataBase64: PNG })).status).toBe(400);
  });

  it('only the uploader or a superadmin can remove one, and it is logged', async () => {
    expect((await as(tok.jaDir, 'delete', `/api/attachments/${id}`)).status).toBe(403);
    expect((await as(tok.jaAcct, 'delete', `/api/attachments/${id}`)).status).toBe(200);
    expect(await M('AuditLog').countDocuments({ action: 'ManualJournal_DETACH' })).toBe(1);
  });
});
