import { describe, it, expect } from 'vitest';
import { normaliseInventoryRow, isSectionRow, isCategoryHeaderCode, readQtyCell, canonicalUnit } from './importSheets';

const read = (row) => normaliseInventoryRow(row);
const stock = (row) => { const n = read(row); return `${n.qty} ${n.displayUnit}`; };

// The layout in use today: the size lives in the product name.
describe('the original layout', () => {
  it('reads a 1kg pack the way the shop writes it', () => {
    const n = read({ Code: 'G10001', Product: 'BEANS PROFILE(2) 1kg', 'Qty Unit': 6, SRP: 386, 'unit cost': 386 });
    expect(n).toMatchObject({ itemCode: 'G10001', itemName: 'BEANS PROFILE(2)', qty: 6, displayUnit: 'kg', unitCost: 386, srp: 386, packSize: 1 });
  });

  it('turns part-kilo packs into the stocking unit, cost included', () => {
    const n = read({ Product: 'FILTER PHIL 250G', 'Qty Unit': 4, 'unit cost': 200 });
    expect(n.qty).toBe(1);            // 4 packs of 250 g
    expect(n.displayUnit).toBe('kg');
    expect(n.unitCost).toBe(800);     // per kg
  });

  it('counts pieces loose, and packed pieces by the pack', () => {
    expect(stock({ Product: '12oz ICED CUPS 50pcs', 'Qty Unit': 104 })).toBe('104 pcs');
    expect(stock({ Product: 'STRAW SMALL 100pcs/pack', 'Qty Unit': 5 })).toBe('500 pcs');
  });

  it('warns when cost was converted but SRP was not', () => {
    const n = read({ Product: 'FILTER PHIL 250G', 'Qty Unit': 4, 'unit cost': 200, SRP: 200 });
    expect(n.srp).toBe(200);
    expect(n._notes.join(' ')).toMatch(/SRP is taken as typed/);
    // A whole-unit pack has no such ambiguity, so it says nothing.
    expect(read({ Product: 'BEANS 1kg', 'Qty Unit': 6, 'unit cost': 386, SRP: 386 })._notes).toEqual([]);
  });

  it('now understands the size spellings people actually type', () => {
    for (const name of ['SUGAR 1 KG', 'SUGAR 1kg.', 'SUGAR (1kg)', 'SUGAR 1 kilo', 'SUGAR 1000 grams']) {
      const n = read({ Product: name, 'Qty Unit': 2 });
      expect(`${name} -> ${n.qty} ${n.displayUnit}`).toBe(`${name} -> 2 kg`);
      expect(n.itemName).toBe('SUGAR');
    }
    expect(stock({ Product: 'JUICE 1 litre', 'Qty Unit': 3 })).toBe('3 L');
    expect(stock({ Product: 'SYRUP 750 ml', 'Qty Unit': 2 })).toBe('1.5 L');
  });

  it('keeps a note in brackets after the size', () => {
    expect(read({ Product: 'MATCHA POWDER 1KG (NW)', 'Qty Unit': 2 }).itemName).toBe('MATCHA POWDER (NW)');
  });

  it('flags a row with no size anywhere instead of dropping it', () => {
    const n = read({ Product: 'SYRUP CARAMEL', 'Qty Unit': 3, 'unit cost': 450 });
    expect(n).toMatchObject({ qty: 3, displayUnit: 'pcs', _needsSize: true });
    expect(n._notes.join(' ')).toMatch(/No size found/);
  });
});

// The clear layout: the size is in its own columns and nothing is guessed.
describe('the Pack / Unit layout', () => {
  const row = (extra) => ({ Code: 'G10003', Product: 'FILTER PHIL', Pack: 250, Unit: 'g', 'Qty (packs)': 4, 'Cost / pack': 200, 'SRP / pack': 260, ...extra });

  it('works out the stock, the cost and the price per stocking unit', () => {
    const n = read(row());
    expect(n).toMatchObject({ itemName: 'FILTER PHIL', qty: 1, displayUnit: 'kg', unitCost: 800, srp: 1040, packSize: 0.25 });
    expect(n._notes).toEqual([]);
  });

  it('treats Pack 1 as a plain amount in that unit', () => {
    expect(read({ Product: 'FRESH MILK', Pack: 1, Unit: 'L', 'Qty (packs)': 20, 'Cost / pack': 82 }))
      .toMatchObject({ qty: 20, displayUnit: 'L', unitCost: 82, packSize: 1 });
  });

  it('counts single pieces loose, and packed pieces by the pack', () => {
    expect(read({ Product: 'CUPS', Pack: 1, Unit: 'pcs', 'Qty (packs)': 104 })).toMatchObject({ qty: 104, displayUnit: 'pcs', packSize: null, looseCount: true });
    expect(read({ Product: 'STRAW', Pack: 100, Unit: 'pcs', 'Qty (packs)': 5 })).toMatchObject({ qty: 500, displayUnit: 'pcs', packSize: 100, looseCount: false });
  });

  it('leaves the name clean even when the size is also written into it', () => {
    expect(read({ Product: 'BEANS PROFILE(2) 1kg', Pack: 1, Unit: 'kg', 'Qty (packs)': 6 }).itemName).toBe('BEANS PROFILE(2)');
  });

  it('accepts an amount typed into the quantity cell', () => {
    expect(stock({ Product: 'SUGAR', Pack: 1, Unit: 'kg', 'Qty (packs)': '500 g' })).toBe('0.5 kg');
  });

  it('reads a word it does not know as a count of packs, and says so', () => {
    const n = read({ Product: 'BEANS', Pack: 1, Unit: 'kg', 'Qty (packs)': '6 crates' });
    expect(n.qty).toBe(6);
    expect(n._notes.join(' ')).toMatch(/"crates" is not a unit/);
  });

  it('is not triggered by the reference columns on an old export', () => {
    // "Display Unit" and a "Pack" label are reference columns, not instructions.
    const n = read({ Code: 'G1', Product: 'FILTER PHIL 250G', 'Qty Unit': 4, 'unit cost': 200, Pack: '250g', 'Display Unit': 'kg' });
    expect(n.qty).toBe(1);
    expect(n.unitCost).toBe(800);
  });
});

describe('quantities and sections', () => {
  it('counts packages when the cell names a package, not a unit', () => {
    expect(stock({ Product: 'BEANS 1kg', 'Qty Unit': '6 packs' })).toBe('6 kg');
    expect(stock({ Product: 'FILTER PHIL 250G', 'Qty Unit': '4 boxes' })).toBe('1 kg');
  });

  it('takes a real unit in the cell as an amount', () => {
    expect(stock({ Product: 'BEANS 1kg', 'Qty Unit': '2 kg' })).toBe('2 kg');
    expect(stock({ Product: 'BEANS 1kg', 'Qty Unit': '500 g' })).toBe('0.5 kg');
  });

  it('marks a row with no quantity instead of counting it as zero', () => {
    expect(read({ Product: 'BEANS 1kg', 'unit cost': 386 })._noQty).toBe(true);
    expect(read({ Product: 'BEANS 1kg', 'Qty Unit': 0, 'unit cost': 386 })._noQty).toBe(false);
  });

  it('knows a section row written either way', () => {
    expect(isCategoryHeaderCode('COFFEE & TEA')).toBe(true);
    expect(isSectionRow(read({ Product: 'COFFEE & TEA' }))).toBe(true);
    // A real item is never mistaken for one.
    expect(isSectionRow(read({ Product: 'BEANS 1kg', 'Qty Unit': 6 }))).toBe(false);
    expect(isSectionRow(read({ Code: 'G1', Product: 'BEANS 1kg' }))).toBe(false);
  });

  it('reads money and quantities written the way spreadsheets format them', () => {
    expect(read({ Product: 'BEANS 1kg', 'Qty Unit': '1,200', 'unit cost': '₱1,800.00' })).toMatchObject({ qty: 1200, unitCost: 1800 });
  });
});

describe('helpers', () => {
  it('maps unit spellings to what the system stores in', () => {
    expect(canonicalUnit('KG')).toEqual({ unit: 'kg', factor: 1 });
    expect(canonicalUnit('grams')).toEqual({ unit: 'kg', factor: 0.001 });
    expect(canonicalUnit('litre')).toEqual({ unit: 'L', factor: 1 });
    expect(canonicalUnit('ml')).toEqual({ unit: 'L', factor: 0.001 });
    expect(canonicalUnit('pieces')).toEqual({ unit: 'pcs', factor: 1 });
    expect(canonicalUnit('gallon')).toBeNull();
  });

  it('reads a quantity cell', () => {
    expect(readQtyCell('6')).toMatchObject({ amount: 6, packs: true });
    expect(readQtyCell('6 kg').unit).toEqual({ unit: 'kg', factor: 1 });
    expect(readQtyCell('6 packs')).toMatchObject({ amount: 6, packs: true, unknownWord: '' });
    expect(readQtyCell('')).toBeNull();
  });
});
