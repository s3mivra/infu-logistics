// Inventory export categories - a LOGISTICS concept.
//
// In a logistics business the stock items ARE the catalogue, grouped into
// stock categories, and the import sheet carries them as header rows: the
// category name in Code with everything else blank, applying to every row
// after it. A stock category is linked to item codes by prefix (G10001 -> G1).
//
// In fb the categories belong to menu products; stock has none. So an fb
// inventory export has no header rows and no category columns at all.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let app, stop, tok;

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'log', jwtSecret: 'invcategory-log-0123456789' }));
  await makeUser({ name: 'CatBoss', role: 'superadmin', password: 'pw' });
  tok = await loginStaff(app, 'CatBoss', 'pw');

  await mongoose.model('StockCategory').create([
    { name: 'COFFEE & TEA', prefix: 'G1', businessType: 'log' },
    { name: 'OTHERS', prefix: 'G4', businessType: 'log' },
    // Longer prefix must win over the shorter one it contains.
    { name: 'SPECIAL TEAS', prefix: 'G19', businessType: 'log' },
    // Another deployment's category must never leak into this export.
    { name: 'CAFE STUFF', prefix: 'G5', businessType: 'fb' },
  ]);
  await mongoose.model('Inventory').create([
    { itemCode: 'G10001', itemName: 'BEANS PROFILE(2)', unit: 'g', businessType: 'log' },
    { itemCode: 'G40005', itemName: 'ALASKA CONDENSED', unit: 'g', businessType: 'log' },
    { itemCode: 'G190001', itemName: 'RARE OOLONG', unit: 'g', businessType: 'log' },
    { itemCode: 'G40001', itemName: 'ALASKA BARISTA MILK', unit: 'ml', stockCategory: 'Dairy', businessType: 'log' },
    { itemCode: 'G50001', itemName: 'HAZELNUT BOMB', unit: 'pcs', businessType: 'log' },
    { itemCode: '', itemName: 'NO CODE ITEM', unit: 'pcs', businessType: 'log' },
  ]);
}, 120000);

afterAll(async () => { await stop(); });

const exportSheet = async () => {
  const res = await request(app).get('/api/export/inventory').set({ Authorization: `Bearer ${tok}` });
  expect(res.status).toBe(200);
  const col = (n) => res.body.columns.indexOf(n);
  return { rows: res.body.rows, col, columns: res.body.columns };
};

// Reads the sheet exactly as the importer does: a row with a Code but no
// Product, whose Code is not item-code shaped, starts a category.
const categoriesAsImported = (rows, col) => {
  let current = '';
  const out = {};
  for (const r of rows) {
    const code = String(r[col('Code')] || '');
    const product = String(r[col('Product')] || '');
    if (!product) {
      if (code && !/^[A-Z]\d+$/i.test(code)) current = code;
      continue;
    }
    out[product] = current;
  }
  return out;
};

describe('logistics inventory export categories', () => {
  it('writes a header row before each category, and nothing else on it', async () => {
    const { rows, col } = await exportSheet();
    const headers = rows.filter(r => !r[col('Product')]);
    expect(headers.map(r => r[col('Code')])).toEqual(['COFFEE & TEA', 'Dairy', 'OTHERS', 'SPECIAL TEAS']);
    for (const h of headers) expect(h.slice(1).every(c => c === '')).toBe(true);
  });

  it('files each item under the right category when read back', async () => {
    const { rows, col } = await exportSheet();
    const cat = categoriesAsImported(rows, col);
    expect(cat['BEANS PROFILE(2)']).toBe('COFFEE & TEA');
    expect(cat['ALASKA CONDENSED']).toBe('OTHERS');
    // Longest prefix wins.
    expect(cat['RARE OOLONG']).toBe('SPECIAL TEAS');
    // A category stored on the item is never overridden by the code.
    expect(cat['ALASKA BARISTA MILK']).toBe('Dairy');
  });

  it('puts uncategorised items first, so no header is applied to them', async () => {
    const { rows, col } = await exportSheet();
    const cat = categoriesAsImported(rows, col);
    // G5 belongs to the fb deployment, so HAZELNUT BOMB has no category here.
    expect(cat['HAZELNUT BOMB']).toBe('');
    expect(cat['NO CODE ITEM']).toBe('');
  });

  it('says where each category came from', async () => {
    const { rows, col, columns } = await exportSheet();
    expect(columns).toContain('Category Source');
    const row = (name) => rows.find(r => r[col('Product')] === name);
    expect(row('BEANS PROFILE(2)')[col('Category Source')]).toBe('Code prefix');
    expect(row('ALASKA BARISTA MILK')[col('Category Source')]).toBe('Item');
  });

  it('every row is exactly as wide as the header', async () => {
    const { rows, columns } = await exportSheet();
    for (const r of rows) expect(r).toHaveLength(columns.length);
  });
});
