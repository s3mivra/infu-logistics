// Reading the coded menu sheet.
//
// The sheet is written by hand at a bar, so it carries the marks of that: "/"
// separating several ingredients in one cell, quantities that line up with them
// left to right, units left off when the thing is counted rather than measured,
// and at least one cell Excel has silently turned into a date.
//
// Everything here is a case taken from a real sheet.
import { describe, it, expect } from 'vitest';
import {
  parseQuantity, recoverMangledQuantities, parseIngredientPair, parseMenuSheet, toImportRows,
} from './menuSheet.js';

// The columns, as the sheet lays them out.
const row = (name, size, pairs, price) => {
  const r = [name, size];
  for (let i = 0; i < 6; i++) { r.push(pairs[i]?.[0] ?? '', pairs[i]?.[1] ?? ''); }
  r.push(price);
  return r;
};
const HEADER = ['Category & Name', 'Base & Extra Size', 'Ingredients', '', '', '', '', '', '', '', '', '', '', '', 'Price'];
const CATEGORY = (n) => [n, '', '', '', '', '', '', '', '', '', '', '', '', '', ''];

describe('a quantity as written on the sheet', () => {
  it('reads a measured amount and its unit', () => {
    expect(parseQuantity('20g')).toEqual({ qty: 20, unit: 'g' });
    expect(parseQuantity('35ml')).toEqual({ qty: 35, unit: 'ml' });
    expect(parseQuantity('0.7ml')).toEqual({ qty: 0.7, unit: 'ml' });
    expect(parseQuantity(' 220 g ')).toEqual({ qty: 220, unit: 'g' });
  });

  it('leaves the unit empty when none was written - that is a count', () => {
    expect(parseQuantity('1')).toEqual({ qty: 1, unit: '' });
    expect(parseQuantity(3)).toEqual({ qty: 3, unit: '' });
  });

  it('refuses anything it cannot read rather than guessing a number out of it', () => {
    expect(parseQuantity('')).toBeNull();
    expect(parseQuantity('a few')).toBeNull();
    expect(parseQuantity('20g each')).toBeNull();
  });
});

// Typing "1/1" into Excel for a cup and a lid stores 46023 - a date - and the
// original text is gone. The two numbers are still in there.
describe('a quantity Excel turned into a date', () => {
  it('recovers the two numbers that were typed', () => {
    expect(recoverMangledQuantities(46023)).toEqual(['1', '1']);
  });

  it('leaves ordinary numbers alone', () => {
    expect(recoverMangledQuantities(1)).toBeNull();
    expect(recoverMangledQuantities(220)).toBeNull();
    expect(recoverMangledQuantities('20g')).toBeNull();
    expect(recoverMangledQuantities(46023.5)).toBeNull();   // not a whole day
  });

  it('turns a mangled cup-and-lid line back into one of each', () => {
    const { lines, problems } = parseIngredientPair('G60004/G60008', 46023);
    expect(problems).toHaveLength(0);
    expect(lines).toEqual([
      { ref: 'G60004', qty: 1, unit: '', recoveredFromDate: true },
      { ref: 'G60008', qty: 1, unit: '', recoveredFromDate: true },
    ]);
  });
});

describe('a pair of ingredient and quantity cells', () => {
  it('lines the two cells up left to right', () => {
    const { lines } = parseIngredientPair('G10002/Water', '20g/35ml');
    expect(lines).toEqual([
      { ref: 'G10002', qty: 20, unit: 'g', recoveredFromDate: false },
      { ref: 'Water', qty: 35, unit: 'ml', recoveredFromDate: false },
    ]);
  });

  it('handles three across', () => {
    const { lines } = parseIngredientPair('G30012/RML-A0002/RML-A0001', '10ml/130ml/130ml');
    expect(lines.map(l => l.ref)).toEqual(['G30012', 'RML-A0002', 'RML-A0001']);
    expect(lines.map(l => l.qty)).toEqual([10, 130, 130]);
  });

  // The real sheet has "Water" against "40ml/40ml" - one ingredient, two
  // quantities. Which 40ml belongs to what is not knowable.
  it('reports a pair that does not line up instead of guessing', () => {
    const { lines, problems } = parseIngredientPair('Water', '40ml/40ml');
    expect(lines).toHaveLength(0);
    expect(problems[0].kind).toBe('count-mismatch');
    expect(problems[0].detail).toMatch(/1 ingredient/);
  });

  it('reports an ingredient with no quantity at all', () => {
    const { lines, problems } = parseIngredientPair('G10002', '');
    expect(lines).toHaveLength(0);
    expect(problems[0].kind).toBe('missing-quantity');
  });
});

describe('reading a whole sheet', () => {
  const SHEET = [
    HEADER,
    CATEGORY('Specialty Black & White'),
    row('Espresso', '2oz Hot', [['Espresso Cup', 1], ['G10002/Water', '20g/35ml']], 99),
    row('Long Black', '8oz Hot', [['G60004/G60008', 46023], ['G10002/Water', '20g/35ml'], ['Water', '200ml']], 100),
    row('', '12oz Iced', [['G60001/G60006', 46023], ['G10002/Water', '20g/35ml'], ['Ice', '100g']], 120),
    CATEGORY('Non Coffee'),
    row('Horchata', '16oz Iced', [['G20009/G40001', '45g/170ml']], 160),
  ];

  it('groups a drink and its sizes into one product', () => {
    const products = parseMenuSheet(SHEET);
    expect(products.map(p => p.name)).toEqual(['Espresso', 'Long Black', 'Horchata']);

    const longBlack = products.find(p => p.name === 'Long Black');
    expect(longBlack.sizes.map(s => s.name)).toEqual(['8oz Hot', '12oz Iced']);
    expect(longBlack.sizes.map(s => s.price)).toEqual([100, 120]);
  });

  it('carries the category heading down to the drinks under it', () => {
    const products = parseMenuSheet(SHEET);
    expect(products.find(p => p.name === 'Espresso').category).toBe('Specialty Black & White');
    expect(products.find(p => p.name === 'Horchata').category).toBe('Non Coffee');
  });

  it("keeps each size's own recipe, not a shared one", () => {
    const [, longBlack] = parseMenuSheet(SHEET);
    const hot = longBlack.sizes[0].ingredients.map(i => i.ref);
    const iced = longBlack.sizes[1].ingredients.map(i => i.ref);
    expect(hot).toContain('G60004');      // hot cup
    expect(iced).toContain('G60001');     // iced cup
    expect(iced).toContain('Ice');
    expect(hot).not.toContain('Ice');
  });

  it('says which row a size came from, so a problem can be found in the file', () => {
    const products = parseMenuSheet(SHEET);
    expect(products.find(p => p.name === 'Espresso').sizes[0].row).toBe(3);
  });
});

describe('turning the sheet into something importable', () => {
  // Two codes exist in stock; everything else is a measured non-stock line.
  const stock = new Map([
    ['g10002', { itemCode: 'G10002', itemName: 'Espresso Beans', unit: 'g' }],
    ['g60004', { itemCode: 'G60004', itemName: '8oz Hot Cup', unit: 'pcs' }],
  ]);

  const products = parseMenuSheet([
    HEADER,
    CATEGORY('Specialty'),
    row('Long Black', '8oz Hot', [['G60004/G60008', 46023], ['G10002/Water', '20g/35ml']], 100),
  ]);

  it('links an identifier that is a stock code', () => {
    const [p] = toImportRows(products, stock);
    const beans = p.sizes[0].ingredients.find(i => i.name === 'G10002');
    expect(beans.stock).toBe(true);
    expect(beans.matchedName).toBe('Espresso Beans');
    expect(beans).toMatchObject({ qty: 20, unit: 'g' });
  });

  it('records anything that is not a code as non-stock', () => {
    const [p] = toImportRows(products, stock);
    const water = p.sizes[0].ingredients.find(i => i.name === 'Water');
    expect(water.nonStock).toBe(true);
    expect(water).toMatchObject({ qty: 35, unit: 'ml' });
    // A code that simply does not exist in stock yet shows up here too, which
    // is how a typo'd code gets noticed.
    expect(p.nonStockNames).toContain('G60008');
  });

  it('counts an unitless quantity as pieces, whatever the item is tracked in', () => {
    const [p] = toImportRows(products, stock);
    const cup = p.sizes[0].ingredients.find(i => i.name === 'G60004');
    expect(cup).toMatchObject({ qty: 1, unit: 'pcs', stock: true });
  });

  it('prices the product from its first size', () => {
    const [p] = toImportRows(products, stock);
    expect(p.srp).toBe(100);
    expect(p.category).toBe('Specialty');
  });
});

// A size recipe replaces the base one at sale time rather than adding to it,
// so an empty base is not harmless: a sale that names no size falls back to it,
// deducts nothing and books no cost. The sheet's first row for a drink is its
// default, so that is what the base has to be.
describe('the base recipe', () => {
  const sheet = parseMenuSheet([
    HEADER,
    CATEGORY('Specialty'),
    row('Long Black', '8oz Hot', [['G10002/Water', '20g/35ml']], 100),
    row('', '12oz Iced', [['G10002/Water', '20g/35ml'], ['Ice', '100g']], 120),
  ]);

  it('is the first size, not empty', () => {
    const [p] = toImportRows(sheet, new Map());
    expect(p.ingredients).toHaveLength(2);
    expect(p.ingredients.map(i => i.name)).toEqual(['G10002', 'Water']);
  });

  it('is the FIRST size, not a merge of all of them', () => {
    const [p] = toImportRows(sheet, new Map());
    // Ice belongs to the iced size alone; putting it in the base would charge
    // every sale for ice it never used.
    expect(p.ingredients.some(i => i.name === 'Ice')).toBe(false);
  });

  it('leaves each size carrying its own recipe as well', () => {
    const [p] = toImportRows(sheet, new Map());
    expect(p.sizes[0].ingredients).toHaveLength(2);
    expect(p.sizes[1].ingredients.some(i => i.name === 'Ice')).toBe(true);
  });
});
