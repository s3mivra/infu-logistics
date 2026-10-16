import { describe, it, expect } from 'vitest';
import { unitChoices, bestUnit, sheetTotals, roundUpTo, priceFrom, marginAt, linesFromProduct, currentPrice } from './costing.js';

const beans = { _id: 'b', itemName: 'BEANS', unit: 'g', unitCost: 0.9, unitMultiplier: 1000, packSize: 1 };       // P900 / kg
const milk = { _id: 'm', itemName: 'MILK', unit: 'ml', unitCost: 0.095, unitMultiplier: 1000, packSize: 1 };    // P95 / L
const syrup = { _id: 's', itemName: 'VANILLA SYRUP', itemCode: 'SYR-VAN', unit: 'ml', unitCost: 0.175, unitMultiplier: 1000, packSize: 2 }; // P350 a 2 L bottle
const inv = new Map([beans, milk, syrup].map(i => [i._id, i]));

describe('costing', () => {
  it('offers the base unit, kg/L, and a pack when there is one', () => {
    expect(unitChoices(beans).map(u => u.label)).toEqual(['g', 'kg']);              // a 1 kg pack is just a kg
    expect(unitChoices(syrup)).toEqual([{ label: 'ml', factor: 1 }, { label: 'L', factor: 1000 }, { label: 'pack', factor: 2000 }]);
  });

  it('adds stock, fixed amounts and percentages in order', () => {
    const t = sheetTotals([
      { kind: 'stock', invId: 'b', qty: 18, unit: 'g' },        // 16.20
      { kind: 'stock', invId: 'm', qty: 0.2, unit: 'L' },       // 19.00
      { kind: 'amount', name: 'Cup and lid', amount: 6 },       //  6.00 -> 41.20
      { kind: 'percent', name: 'Wastage', percent: 5 },         //  2.06 -> 43.26
      { kind: 'percent', name: 'Overhead', percent: 10 },       //  4.326 -> 47.586
    ], inv);
    expect(t.lines).toEqual([16.2, 19, 6, 2.06, 4.326]);
    expect(t.cost).toBeCloseTo(47.586, 4);
  });

  it('a stock item that is gone costs nothing rather than breaking the sheet', () => {
    expect(sheetTotals([{ kind: 'stock', invId: 'nope', qty: 5, unit: 'g' }], inv).cost).toBe(0);
  });

  it('rounding only goes up', () => {
    expect(roundUpTo(121.1, 5)).toBe(125);
    expect(roundUpTo(125, 5)).toBe(125);
    expect(roundUpTo(99.999, 0)).toBe(100);
    expect(roundUpTo(12.34, 0.25)).toBe(12.5);
  });

  it('markup and margin are different things, and both are reported', () => {
    expect(priceFrom({ cost: 100, method: 'markup', rate: 50 })).toMatchObject({ srp: 150, profit: 50, margin: 33.33, markup: 50 });
    expect(priceFrom({ cost: 100, method: 'margin', rate: 50 })).toMatchObject({ srp: 200, profit: 100, margin: 50, markup: 100 });
    expect(priceFrom({ cost: 100, method: 'margin', rate: 100 }).error).toMatch(/under 100/);
  });

  it('VAT goes on top, and the margin is worked out on the price without it', () => {
    const p = priceFrom({ cost: 100, method: 'margin', rate: 40, vatRate: 12, rounding: 5 });
    // 100 / 0.6 = 166.67, + 12% = 186.67, up to 190.
    expect(p.srp).toBe(190);
    expect(p.exVat).toBeCloseTo(169.64, 2);
    expect(p.margin).toBeCloseTo(41.05, 2);                                          // a little over 40, from rounding up
    expect(marginAt(190, 100, 12)).toBeCloseTo(41.05, 2);
  });

  it('fills a cafe drink from its recipe, or the size asked for', () => {
    const latte = {
      name: 'LATTE', basePrice: 150,
      baseRecipe: [{ invId: 'b', name: 'BEANS', qty: 18 }, { invId: 'm', name: 'MILK', qty: 200 }, { name: 'WATER', qty: 30, nonStock: true }],
      sizes: [{ name: 'Large', price: 170, recipe: [{ invId: 'b', name: 'BEANS', qty: 24 }, { name: 'OLD SYRUP', qty: 10, cost: 0.2 }] }],
    };
    const inventory = [beans, milk, syrup];
    expect(linesFromProduct(latte, { inventory })).toEqual([
      { kind: 'stock', invId: 'b', name: 'BEANS', qty: 18, unit: 'g' },
      { kind: 'stock', invId: 'm', name: 'MILK', qty: 200, unit: 'ml' },
    ]);
    expect(bestUnit(syrup, 2000)).toEqual({ unit: 'pack', qty: 1 });             // a whole 2 L bottle
    expect(bestUnit(milk, 1500)).toEqual({ unit: 'L', qty: 1.5 });
    expect(bestUnit(beans, 18)).toEqual({ unit: 'g', qty: 18 });
    const large = linesFromProduct(latte, { sizeIndex: 0, inventory });
    expect(large[0]).toMatchObject({ invId: 'b', qty: 24 });
    expect(large[1]).toMatchObject({ kind: 'amount', amount: 2 });                   // gone from stock: kept, by its last cost
    expect(currentPrice(latte)).toBe(150);
    expect(currentPrice(latte, 0)).toBe(170);
  });

  it('fills a logistics product from the stock item it sells: one whole bottle', () => {
    const lines = linesFromProduct({ name: 'Vanilla Syrup 2L', productCode: 'SYR-VAN', basePrice: 450 }, { inventory: [syrup] });
    expect(lines).toEqual([{ kind: 'stock', invId: 's', name: 'VANILLA SYRUP', qty: 1, unit: 'pack' }]);
    expect(sheetTotals(lines, inv).cost).toBe(350);
  });
});
