// A template has to be the sheet the importer will accept.
//
// It used to be the EXPORT with its rows removed, which sounds equivalent and
// is not. An export carries what the system knows - the code it assigned, the
// balance it derived, the status it computed. An import needs what a person
// must supply. The two lists overlap; they are not the same.
//
// The bills template proved it. The export reads
//   Bill No | Supplier | Description | Amount | Paid | Outstanding | Status | Due Date
// and the importer needs an ACCOUNT to charge the bill to, which is not there,
// while Bill No, Paid, Outstanding and Status are things it cannot use at all.
// Filling that sheet in produced a file where every single row was rejected.
//
// These tests take each template and feed its own example row straight to its
// own importer. If a template ever drifts from what the importer accepts, the
// round trip fails here rather than on someone's evening of data entry.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';
import { DATASETS } from '../lib/dataSets.js';

let ctx, app, tok;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);
const M = (n) => mongoose.model(n);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'TmplSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'TmplSuper');
}, 120000);

afterAll(async () => { await ctx.stop(); });

const template = (key) => auth('get', `/api/export/${key}?template=1`);

// The template's own example row, as an object the importer would receive.
const exampleRow = (body) =>
  Object.fromEntries(body.columns.map((c, i) => [c, body.example[i]]).filter(([, v]) => v !== ''));

const IMPORTABLE = Object.entries(DATASETS).filter(([, d]) => d.importable);

describe('every importable dataset describes its own template', () => {
  it('finds the ones that claim to be importable', () => {
    // If this list shrinks, something lost its importSpec.
    expect(IMPORTABLE.map(([k]) => k).sort()).toEqual(
      ['bills', 'clients', 'expenses', 'fixedAssets', 'inventory', 'products', 'suppliers'],
    );
  });

  for (const [key, def] of IMPORTABLE) {
    if (!def.importSpec) continue;   // products is imported through its own recipe flow

    it(`${key}: names every required field and says what it is for`, async () => {
      const { body } = await template(key);
      expect(body.importable).toBe(true);
      expect(body.columns.length).toBeGreaterThan(0);
      expect(body.fields.length).toBe(body.columns.length);

      // A required field with no explanation is the one someone leaves blank.
      for (const f of body.fields) {
        expect(f.name, `${key} field has no name`).toBeTruthy();
        if (f.required) expect(f.example, `${key}.${f.name} is required but has no example`).not.toBe('');
      }
      expect(body.fields.some(f => f.required), `${key} has no required field at all`).toBe(true);
      expect(body.intro, `${key} has no explanation`).toBeTruthy();
    });

    it(`${key}: ships a worked example, one value per column`, async () => {
      const { body } = await template(key);
      expect(body.example).toHaveLength(body.columns.length);
    });
  }
});

describe('the template round-trips through its own importer', () => {
  beforeEach(async () => {
    for (const n of ['Supplier', 'Bill', 'ClientAccount', 'Inventory', 'FixedAsset', 'JournalEntry', 'Settings']) {
      await M(n).deleteMany({});
    }
  });

  it('suppliers', async () => {
    const { body } = await template('suppliers');
    const res = await auth('post', '/api/suppliers/import').send({ rows: [exampleRow(body)] });
    expect(res.body.created, JSON.stringify(res.body.skipped)).toBe(1);
  }, 30000);

  it('clients', async () => {
    const { body } = await template('clients');
    const res = await auth('post', '/api/client-accounts/import').send({ rows: [exampleRow(body)] });
    expect(res.body.created, JSON.stringify(res.body.skipped)).toBe(1);
  }, 30000);

  it('fixed assets', async () => {
    const { body } = await template('fixedAssets');
    const res = await auth('post', '/api/fixed-assets/import').send({ rows: [exampleRow(body)] });
    expect(res.body.created, JSON.stringify(res.body.skipped)).toBe(1);
  }, 30000);

  it('expenses', async () => {
    const { body } = await template('expenses');
    const res = await auth('post', '/api/expenses/import').send({ rows: [exampleRow(body)] });
    expect(res.body.created, JSON.stringify(res.body.skipped)).toBe(1);
  }, 30000);

  it('bills', async () => {
    // Bills reference a supplier by name, which the template's own example
    // names - so the supplier has to exist first. The template says so.
    const supplierTpl = await template('suppliers');
    await auth('post', '/api/suppliers/import').send({ rows: [exampleRow(supplierTpl.body)] });

    const { body } = await template('bills');
    const res = await auth('post', '/api/bills/import').send({ rows: [exampleRow(body)] });
    expect(res.body.created, JSON.stringify(res.body.skipped)).toBe(1);
  }, 30000);

  it('inventory', async () => {
    const { body } = await template('inventory');
    const row = exampleRow(body);
    const res = await auth('post', '/api/inventory/import').send({ items: [row] });
    expect(res.body.success).toBe(true);
    expect(await M('Inventory').countDocuments({})).toBe(1);
  }, 30000);
});

describe('what a template must never contain', () => {
  it('does not ask for a bill number, or its paid and outstanding amounts', async () => {
    const { body } = await template('bills');
    // These are outputs. Asking for them invites someone to fill in four
    // columns nothing reads.
    for (const derived of ['Bill No', 'Paid', 'Outstanding', 'Status']) {
      expect(body.columns).not.toContain(derived);
    }
    // And the one the importer actually requires IS there.
    expect(body.columns).toContain('expenseAccountCode');
  });

  it('does not ask for a credit balance the system works out', async () => {
    const { body } = await template('clients');
    expect(body.columns).not.toContain('Credit Balance');
    expect(body.columns).not.toContain('Client Code');
  });

  it('never asks for a password', async () => {
    const { body } = await template('clients');
    const joined = JSON.stringify(body).toLowerCase();
    expect(joined).not.toContain('"password"');
    // It says why, so nobody goes looking for the column.
    expect(body.intro).toMatch(/onboarding link/i);
  });

  it('does not ask for an asset code or its accumulated status', async () => {
    const { body } = await template('fixedAssets');
    expect(body.columns).not.toContain('Asset Code');
    expect(body.columns).not.toContain('Net Book Value');
    expect(body.columns).toContain('usefulLifeMonths');
  });
});

describe('an export-only dataset', () => {
  it('says so rather than offering a template that leads nowhere', async () => {
    const { body } = await template('journal');
    expect(body.importable).toBe(false);
    expect(body.note).toMatch(/export-only/i);
  });
});
