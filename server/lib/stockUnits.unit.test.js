// Unit arithmetic behind every stock movement: display units convert to base
// units (g, ml, pcs) once, at the edge, and a pack is packSize x multiplier.
import { describe, it, expect } from 'vitest';
import { resolveUnit, displayToBase, unitTypeOf, basePerPack } from './units.js';
import { stockMovesFrom, movesToReturn, roundQty } from './stockMoves.js';

describe('display unit -> base unit', () => {
  it('kg and L are 1000 base units; g, ml and pcs are 1', () => {
    expect(resolveUnit('kg')).toEqual({ base: 'g', mult: 1000 });
    expect(resolveUnit('L')).toEqual({ base: 'ml', mult: 1000 });
    expect(resolveUnit('g').mult).toBe(1);
    expect(resolveUnit('ml').mult).toBe(1);
    expect(resolveUnit('pcs')).toEqual({ base: 'pcs', mult: 1 });
  });

  it('boundaries: zero, one base unit, very large, very small', () => {
    expect(displayToBase(0, 'kg')).toBe(0);
    expect(displayToBase(0.001, 'kg')).toBeCloseTo(1, 9);          // 1 g
    expect(displayToBase(1_000_000, 'L')).toBe(1_000_000_000);
    expect(displayToBase(0.000001, 'kg')).toBeCloseTo(0.001, 12);
  });

  it('weight, volume and count never convert into each other', () => {
    expect(unitTypeOf('kg')).toBe('mass');
    expect(unitTypeOf('ml')).toBe('volume');
    expect(unitTypeOf('pcs')).toBe('count');
    expect(resolveUnit('kg').base).not.toBe(resolveUnit('L').base);
  });
});

describe('one pack in base units', () => {
  it('a 377 g can shown in kg is 377 g, not 1000', () => {
    expect(basePerPack({ unitMultiplier: 1000, packSize: 0.377 })).toBe(377);
  });
  it('carries no float noise', () => {
    expect(0.1 * 3).not.toBe(0.3);                                  // the raw product drifts
    expect(basePerPack({ unitMultiplier: 3, packSize: 0.1 })).toBe(0.3);
  });
  it('no pack: one display unit', () => {
    expect(basePerPack({ unitMultiplier: 1000 })).toBe(1000);
    expect(basePerPack({ unitMultiplier: 1 })).toBe(1);
    expect(basePerPack({})).toBe(1);
  });
  it('a 740 ml bottle, a 2.8 kg tub, a 60 kg sack', () => {
    expect(basePerPack({ unitMultiplier: 1000, packSize: 0.74 })).toBe(740);
    expect(basePerPack({ unitMultiplier: 1000, packSize: 2.8 })).toBe(2800);
    expect(basePerPack({ unitMultiplier: 1000, packSize: 60 })).toBe(60000);
  });
});

describe('what a sale took, and giving it back', () => {
  const order = {
    items: [{ quantity: 3 }, { quantity: 2 }],
    stockMoves: stockMovesFrom([
      { inventoryId: 'beans', qtyChange: -54, unitCost: 1.2, lineIndex: 0 },
      { inventoryId: 'milk', qtyChange: -600, unitCost: 0.08, lineIndex: 0 },
      { inventoryId: 'beans', qtyChange: -36, unitCost: 1.5, lineIndex: 1 },
      { inventoryId: 'milk', qtyChange: +5, lineIndex: 1 },            // not a take: ignored
    ]),
  };

  it('keeps only what left, in base units, with its cost and line', () => {
    expect(order.stockMoves).toEqual([
      { invId: 'beans', qty: 54, unitCost: 1.2, lineIndex: 0 },
      { invId: 'milk', qty: 600, unitCost: 0.08, lineIndex: 0 },
      { invId: 'beans', qty: 36, unitCost: 1.5, lineIndex: 1 },
    ]);
  });

  it('a void gives back everything, one move per item, valued at sale cost', () => {
    const back = movesToReturn(order);
    const beans = back.find(m => m.invId === 'beans');
    expect(beans.qty).toBe(90);
    expect(beans.value).toBeCloseTo(54 * 1.2 + 36 * 1.5, 6);
    expect(back.find(m => m.invId === 'milk').qty).toBe(600);
  });

  it('a partial refund gives back that line\'s share', () => {
    const back = movesToReturn(order, [{ lineIndex: 0, qty: 1 }]);   // 1 of 3
    expect(back.find(m => m.invId === 'beans').qty).toBe(18);
    expect(back.find(m => m.invId === 'milk').qty).toBe(200);
  });

  it('never gives back more than the line took', () => {
    const back = movesToReturn(order, [{ lineIndex: 1, qty: 5 }]);   // only 2 sold
    expect(back.find(m => m.invId === 'beans').qty).toBe(36);
  });

  it('rounding holds over thousands of small moves', () => {
    let total = 0;
    for (let i = 0; i < 10000; i++) total = roundQty(total + 0.1);
    expect(total).toBe(1000);
  });
});
