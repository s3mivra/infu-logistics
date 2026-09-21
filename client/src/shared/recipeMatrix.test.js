import { describe, it, expect } from 'vitest';
import { matrixRows, setCell, removeRow, addSizeColumn, removeSizeColumn, marginOf, readiness, rowKeyOf } from './recipeMatrix.js';

// A latte the way it is stored today: 8oz Hot as the base, 12oz Iced as a size.
const latte = () => ({
  baseSize: '8oz Hot', basePrice: 120,
  baseRecipe: [
    { invId: 'beans', name: 'ESPRESSO BEANS', qty: 18, cost: 1.2, unit: 'g', packBase: 1 },
    { invId: 'milk', name: 'FRESH MILK', qty: 180, cost: 0.1, unit: 'ml', packBase: 1 },
  ],
  sizes: [{
    name: '12oz Iced', price: 140,
    recipe: [
      { invId: 'beans', name: 'ESPRESSO BEANS', qty: 18, cost: 1.2, unit: 'g', packBase: 1 },
      { invId: 'milk', name: 'FRESH MILK', qty: 200, cost: 0.1, unit: 'ml', packBase: 1 },
      { invId: 'cup12', name: '12OZ ICED CUPS', qty: 1, cost: 3.2, unit: 'pcs', packBase: 1 },
    ],
  }],
});

describe('reading a product into a grid', () => {
  it('lists each ingredient once, with an amount per size', () => {
    const rows = matrixRows(latte());
    expect(rows.map((r) => r.name)).toEqual(['ESPRESSO BEANS', 'FRESH MILK', '12OZ ICED CUPS']);
    expect(rows.find((r) => r.invId === 'milk').cells).toEqual([180, 200]);
    // Not in the hot size: an empty cell, not a zero line.
    expect(rows.find((r) => r.invId === 'cup12').cells[0]).toBeUndefined();
  });

  it('shows a logistics line in packs', () => {
    const f = { baseRecipe: [{ invId: 'can', name: 'CONDENSED 377G', qty: 754, unit: 'pcs', packBase: 377 }], sizes: [] };
    expect(matrixRows(f)[0].cells[0]).toBe(2);
  });

  it('keeps a row that has no amount yet', () => {
    const rows = matrixRows(latte(), [{ key: 'inv:ice', invId: 'ice', name: 'ICE', unit: 'g', packBase: 1 }]);
    expect(rows.map((r) => r.name)).toContain('ICE');
  });
});

describe('typing into a cell', () => {
  const rowOf = (f, id) => matrixRows(f).find((r) => r.invId === id);

  it('changes that size only', () => {
    const f = setCell(latte(), rowOf(latte(), 'milk'), 1, '220');
    expect(f.sizes[0].recipe.find((l) => l.invId === 'milk').qty).toBe(220);
    expect(f.baseRecipe.find((l) => l.invId === 'milk').qty).toBe(180);
  });

  it('adds the ingredient to a size that did not have it', () => {
    const f = setCell(latte(), rowOf(latte(), 'cup12'), 0, '1');
    expect(f.baseRecipe.map((l) => l.invId)).toContain('cup12');
  });

  it('takes it out again at zero or blank', () => {
    const f1 = setCell(latte(), rowOf(latte(), 'cup12'), 1, '0');
    expect(f1.sizes[0].recipe.map((l) => l.invId)).not.toContain('cup12');
    const f2 = setCell(latte(), rowOf(latte(), 'milk'), 0, '');
    expect(f2.baseRecipe.map((l) => l.invId)).not.toContain('milk');
  });

  it('stores a logistics amount as packs times pack size', () => {
    const f = { baseRecipe: [], sizes: [] };
    const row = { key: 'inv:can', invId: 'can', name: 'CONDENSED 377G', unit: 'pcs', packBase: 377 };
    expect(setCell(f, row, 0, '3').baseRecipe[0]).toMatchObject({ qty: 1131, packBase: 377 });
  });

  it('writes a non-stock line without an inventory link', () => {
    const row = { key: rowKeyOf({ name: 'Filtered Water' }), invId: null, name: 'Filtered Water', unit: 'ml', packBase: 1, nonStock: true };
    const line = setCell({ baseRecipe: [], sizes: [] }, row, 0, '60').baseRecipe[0];
    expect(line).toMatchObject({ name: 'Filtered Water', qty: 60, nonStock: true });
    expect(line.invId).toBeUndefined();
  });
});

describe('rows and sizes', () => {
  it('removes an ingredient from every size', () => {
    const f = removeRow(latte(), 'inv:beans');
    expect(f.baseRecipe.some((l) => l.invId === 'beans')).toBe(false);
    expect(f.sizes[0].recipe.some((l) => l.invId === 'beans')).toBe(false);
  });

  it('a new size starts as a copy of the base recipe, not linked to it', () => {
    const f = addSizeColumn(latte());
    expect(f.sizes).toHaveLength(2);
    expect(f.sizes[1].recipe.map((l) => l.invId)).toEqual(['beans', 'milk']);
    f.sizes[1].recipe[0].qty = 99;
    expect(f.baseRecipe[0].qty).toBe(18);
  });

  it('never removes the base size', () => {
    expect(removeSizeColumn(latte(), 0)).toEqual(latte());
    expect(removeSizeColumn(latte(), 1).sizes).toHaveLength(0);
  });
});

describe('what needs doing', () => {
  const cost = (recipe) => recipe.reduce((s, l) => s + l.qty * l.cost, 0);
  it('works out margin on price', () => {
    expect(marginOf(100, 30)).toBeCloseTo(0.7);
    expect(marginOf(0, 30)).toBeNull();
  });
  it('flags a size with no recipe, no price, or sold below cost', () => {
    const f = { baseSize: 'Regular', basePrice: 10, baseRecipe: [{ invId: 'x', name: 'X', qty: 5, cost: 4, unit: 'g', packBase: 1 }], sizes: [{ name: '', price: 0, recipe: [] }] };
    const issues = readiness(f, cost).join(' | ');
    expect(issues).toMatch(/Regular sells for less than it costs/);
    expect(issues).toMatch(/Size 2 has no name/);
    expect(issues).toMatch(/no price/);
    expect(issues).toMatch(/no recipe/);
  });
  it('is quiet for a finished product', () => {
    expect(readiness(latte(), cost)).toEqual([]);
  });
});
