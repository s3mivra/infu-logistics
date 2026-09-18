// A piece size in a product name: pack or description?
//
// A weight or volume in a name is always a pack - "CONDENSED MILK 377g | 10"
// is ten cans. A piece count is not. A bar's stock sheet reads:
//
//   12oz ICED CUPS 50pcs   104   3.2
//
// and 104 is cups on the shelf at P3.20 each; "50pcs" only says what a sleeve
// holds. The importer read it as 104 SLEEVES: 5,200 cups at P0.064 - stock
// fifty times too high and every cup costed at a fiftieth of its price, so
// every drink looked more profitable than it was.
//
// Supplies on the same sheet are counted by the pack, and the sheet now says
// so: "STRAW SMALL 100pcs/pack | 5 | 45" is five packs, 500 straws at P0.45.
// The rows below are the bar's own, as written.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';
import { normaliseInventoryRow, inventoryImportPayload } from '../../client/src/shared/importSheets.js';

let app, stop, tok;
const M = (n) => mongoose.model(n);

beforeAll(async () => {
  ({ app, stop } = await bootApp({ businessType: 'fb', jwtSecret: 'import-pieces-0123456789' }));
  await makeUser({ name: 'Owner', role: 'superadmin', password: 'pw' });
  tok = await loginStaff(app, 'Owner', 'pw');
  // The server builds these indexes in the background at boot. An import is a
  // transaction, and a transaction that is first to touch a collection while
  // its index is still being built can be refused - so wait for them here
  // rather than let the first test race the boot.
  await Promise.all(['Inventory', 'StockCard', 'JournalEntry'].map(n => M(n).init()));
}, 120000);

afterAll(async () => { await stop(); });
beforeEach(async () => { await M('Inventory').deleteMany({}); });

// A row exactly as sheet_to_json reads the bar's file, header and all.
const sheetRow = (code, product, qty, cost) => ({ Code: code, Product: product, 'Qty Unit': qty, SRP: cost, 'unit cost': cost });

// The Inventory tab's own import: its row reader, then its payload.
const importRows = (rows) => request(app).post('/api/inventory/import')
  .set({ Authorization: `Bearer ${tok}` })
  .send(inventoryImportPayload(rows.map(normaliseInventoryRow)));

const stored = (code) => M('Inventory').findOne({ itemCode: code }).lean();

describe('a piece size with no qualifier is a description', () => {
  it('takes the number as the count, and the cost as per piece', async () => {
    const res = await importRows([sheetRow('G60001', '12oz ICED CUPS 50pcs', 104, 3.2)]);
    expect(res.body.success).toBe(true);

    const cups = await stored('G60001');
    expect(cups.stockQty).toBe(104);             // not 5,200
    expect(cups.unitCost).toBeCloseTo(3.2, 6);   // not 0.064
    expect(cups.unit).toBe('pcs');
    expect(cups.packSize ?? null).toBe(null);    // not a packed item: nothing to divide by
  });

  it('holds for every cup and lid on the bar\'s sheet', async () => {
    await importRows([
      sheetRow('G60002', '16oz ICED CUPS 50pcs', 362, 3.65),
      sheetRow('G60004', '8oz HOT CUPS 25pcs', 17, 5.1),
      sheetRow('G60006', '98mm STRAWLESS LIDS 100pcs', 310, 1.1),
      sheetRow('G60009', '12oz HOT LIDS 50pcs', 68, 2.5),
    ]);
    for (const [code, qty, cost] of [['G60002', 362, 3.65], ['G60004', 17, 5.1], ['G60006', 310, 1.1], ['G60009', 68, 2.5]]) {
      const it = await stored(code);
      expect({ code, qty: it.stockQty, cost: +it.unitCost.toFixed(6) }).toEqual({ code, qty, cost });
    }
  });
});

describe('a piece size that says "/pack" or "/box" is a pack', () => {
  it('multiplies packs into pieces and divides the pack price', async () => {
    await importRows([sheetRow('G40007', 'STRAW SMALL 100pcs/pack', 5, 45)]);
    const straws = await stored('G40007');
    expect(straws.stockQty).toBe(500);
    expect(straws.unitCost).toBeCloseTo(0.45, 6);
    expect(straws.packSize).toBe(100);
  });

  it('reads the chargers the sheet already marks "/box"', async () => {
    // "10pcs/box" was not recognised at all before, so 22 boxes came in as 22
    // chargers at P150 each - the price of a box, charged per charger.
    await importRows([sheetRow('G40018', 'CREAM CHARGER 10pcs/box', 22, 150)]);
    const chargers = await stored('G40018');
    expect(chargers.stockQty).toBe(220);
    expect(chargers.unitCost).toBeCloseTo(15, 6);
    expect(chargers.packSize).toBe(10);
  });
});

describe('weights and volumes are unchanged', () => {
  it('still reads a size in kg, g, L or ml as a pack', async () => {
    await importRows([
      sheetRow('G30004', 'BODUO STRAWBERRY SYRUP 2L', 2, 320),
      sheetRow('G40005', 'ALASKA CONDENSED 377g', 10, 66),
    ]);
    const syrup = await stored('G30004');
    expect(syrup.stockQty).toBe(4000);                 // 2 bottles x 2 L, in ml
    expect(syrup.unitCost).toBeCloseTo(320 / 2000, 6); // per ml
    const milk = await stored('G40005');
    expect(milk.stockQty).toBeCloseTo(3770, 6);        // 10 cans x 377 g
  });
});

// The books, as the ledger has them: Inventory Asset, and the spoilage expense
// a recount books a shortfall to.
const ledger = async (code) => {
  let bal = 0;
  for (const je of await M('JournalEntry').find({}).lean()) {
    for (const l of je.lines || []) if (l.accountCode === code) bal += (l.debit || 0) - (l.credit || 0);
  }
  return Math.round(bal * 100) / 100;
};
const stockValue = async () => {
  const all = await M('Inventory').find({}).lean();
  return Math.round(all.reduce((t, i) => t + (i.stockQty || 0) * (i.unitCost || 0), 0) * 100) / 100;
};
// What the old reading of "12oz ICED CUPS 50pcs | 104 | 3.2" stored, put in
// through the importer itself so the ledger holds its journal entry too.
const theOldImport = () => request(app).post('/api/inventory/import').set({ Authorization: `Bearer ${tok}` })
  .send({ items: [{ itemCode: 'G60001', itemName: '12OZ ICED CUPS', displayUnit: 'pcs', qty: 5200, unitCost: 0.064, packSize: 50 }] });

describe('correcting stock an earlier import got wrong', () => {
  beforeEach(async () => { await M('JournalEntry').deleteMany({}); await M('StockCard').deleteMany({}); });

  it('sets the real count and cost, and takes the pack off', async () => {
    await theOldImport();
    await importRows([sheetRow('G60001', '12oz ICED CUPS 50pcs', 104, 3.2)]);
    const cups = await stored('G60001');
    expect(cups.stockQty).toBe(104);
    expect(cups.unitCost).toBeCloseTo(3.2, 6);
    // The part a corrected sheet could not do before: a row could put a pack
    // on an item but never take one off, so the screens went on dividing by 50.
    expect(cups.packSize ?? null).toBe(null);
  });

  it('books nothing when the shelf matches: the old figures were the right value in the wrong unit', async () => {
    await theOldImport();
    expect(await ledger('130000')).toBe(332.8);

    await importRows([sheetRow('G60001', '12oz ICED CUPS 50pcs', 104, 3.2)]);

    // 104 cups at P3.20 is the same P332.80 as 5,200 at P0.064. Before, this
    // left the ledger at P6.66 and a P326 spoilage loss that never happened.
    expect(await ledger('130000')).toBe(332.8);
    expect(await ledger('535000')).toBe(0);
    expect(await ledger('130000')).toBe(await stockValue());

    // And the stock card says what was done, instead of showing cups vanish.
    const note = await M('StockCard').findOne({ type: 'Unit Correction' }).lean();
    expect(note.qtyChange).toBe(104 - 5200);
    expect(note.remarks).toMatch(/Value unchanged/);
  });

  it('books only the real difference when the shelf does not match', async () => {
    await theOldImport();
    // Four cups short of what was recorded.
    await importRows([sheetRow('G60001', '12oz ICED CUPS 50pcs', 100, 3.2)]);
    expect(await ledger('535000')).toBe(12.8);           // 4 cups at P3.20, not 5,100 at P0.064
    expect(await ledger('130000')).toBe(320);
    expect(await ledger('130000')).toBe(await stockValue());
  });
});

describe('a stock sheet that changes a price', () => {
  beforeEach(async () => { await M('JournalEntry').deleteMany({}); await M('StockCard').deleteMany({}); });

  it('moves the books with the stock, against capital rather than the P&L', async () => {
    // Syrup counted again, and the supplier's new price typed into the same row.
    const seed = { itemCode: 'G30001', itemName: 'VANILLA SYRUP', displayUnit: 'L', qty: 2, unitCost: 300 };
    await request(app).post('/api/inventory/import').set({ Authorization: `Bearer ${tok}` }).send({ items: [seed] });
    expect(await ledger('130000')).toBe(600);

    await request(app).post('/api/inventory/import').set({ Authorization: `Bearer ${tok}` })
      .send({ items: [{ ...seed, qty: 3, unitCost: 320 }] });

    // One more litre found, and the price is now P320: 3 x 320.
    expect(await stockValue()).toBe(960);
    // Before, the ledger stopped at 900 and read 60 short from then on.
    expect(await ledger('130000')).toBe(960);
  });
});

describe('the app\'s own export, imported back', () => {
  it('writes a packed piece item so that it comes back as packs', async () => {
    await M('Inventory').create({
      itemCode: 'G40007', itemName: 'STRAW SMALL', unit: 'pcs', displayUnit: 'pcs', unitMultiplier: 1,
      packSize: 100, stockQty: 500, unitCost: 0.45, businessType: 'fb',
    });
    const exp = await request(app).get('/api/export/inventory').set({ Authorization: `Bearer ${tok}` });
    const col = (n) => exp.body.columns.indexOf(n);
    const row = exp.body.rows.find(r => r[col('Code')] === 'G40007');
    expect(row[col('Product')]).toBe('STRAW SMALL 100pcs/pack');
    expect(row[col('Qty Unit')]).toBe(5);

    await M('Inventory').deleteMany({});
    const asObject = Object.fromEntries(exp.body.columns.map((c, i) => [c, row[i]]));
    await importRows([asObject]);
    const back = await stored('G40007');
    expect(back.stockQty).toBe(500);
    expect(back.unitCost).toBeCloseTo(0.45, 6);
    expect(back.packSize).toBe(100);
  });

  it('writes a loose piece item as a plain count, which comes back as the same count', async () => {
    await M('Inventory').create({
      itemCode: 'G60001', itemName: '12OZ ICED CUPS', unit: 'pcs', displayUnit: 'pcs', unitMultiplier: 1,
      packSize: null, stockQty: 104, unitCost: 3.2, businessType: 'fb',
    });
    const exp = await request(app).get('/api/export/inventory').set({ Authorization: `Bearer ${tok}` });
    const col = (n) => exp.body.columns.indexOf(n);
    const row = exp.body.rows.find(r => r[col('Code')] === 'G60001');

    await M('Inventory').deleteMany({});
    await importRows([Object.fromEntries(exp.body.columns.map((c, i) => [c, row[i]]))]);
    const back = await stored('G60001');
    expect(back.stockQty).toBe(104);
    expect(back.unitCost).toBeCloseTo(3.2, 6);
  });
});
