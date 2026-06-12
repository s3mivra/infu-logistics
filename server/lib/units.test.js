import { describe, it, expect } from 'vitest';
import { UNIT_TABLE, resolveUnit, displayToBase, baseToDisplayCost, effectiveDisplay } from './units.js';

describe('effectiveDisplay — never surface g/ml', () => {
  it('promotes base g to kg (×1000)', () => {
    expect(effectiveDisplay({ unit: 'g' })).toEqual({ displayUnit: 'kg', mult: 1000 });
  });
  it('promotes base ml to L (×1000)', () => {
    expect(effectiveDisplay({ unit: 'ml' })).toEqual({ displayUnit: 'L', mult: 1000 });
  });
  it('leaves pcs as pcs (×1)', () => {
    expect(effectiveDisplay({ unit: 'pcs' })).toEqual({ displayUnit: 'pcs', mult: 1 });
  });
  it('promotes even when displayUnit is wrongly set to g/ml', () => {
    expect(effectiveDisplay({ unit: 'g', displayUnit: 'g' })).toEqual({ displayUnit: 'kg', mult: 1000 });
    expect(effectiveDisplay({ unit: 'ml', displayUnit: 'ml' })).toEqual({ displayUnit: 'L', mult: 1000 });
  });
  it('honors an explicit proper display unit', () => {
    expect(effectiveDisplay({ unit: 'g', displayUnit: 'kg' })).toEqual({ displayUnit: 'kg', mult: 1000 });
    expect(effectiveDisplay({ unit: 'ml', displayUnit: 'L' })).toEqual({ displayUnit: 'L', mult: 1000 });
  });
  it('converts 10000 g of stock to 10 kg for display', () => {
    const { mult } = effectiveDisplay({ unit: 'g' });
    expect(10000 / mult).toBe(10);
  });
});

describe('UNIT_TABLE coverage', () => {
  it('defines all 5 supported units', () => {
    expect(Object.keys(UNIT_TABLE).sort()).toEqual(['L', 'g', 'kg', 'ml', 'pcs']);
  });
  it('kg and L use multiplier 1000', () => {
    expect(UNIT_TABLE.kg.mult).toBe(1000);
    expect(UNIT_TABLE.L.mult).toBe(1000);
  });
  it('g, ml, pcs use multiplier 1', () => {
    expect(UNIT_TABLE.g.mult).toBe(1);
    expect(UNIT_TABLE.ml.mult).toBe(1);
    expect(UNIT_TABLE.pcs.mult).toBe(1);
  });
  it('kg base is g, L base is ml', () => {
    expect(UNIT_TABLE.kg.base).toBe('g');
    expect(UNIT_TABLE.L.base).toBe('ml');
  });
});

describe('resolveUnit case-insensitive fallback', () => {
  it('handles canonical units', () => {
    expect(resolveUnit('L').mult).toBe(1000);
    expect(resolveUnit('kg').mult).toBe(1000);
  });
  it('handles "liter" / "litre" / "l"', () => {
    expect(resolveUnit('l').mult).toBe(1000);
    expect(resolveUnit('liter').mult).toBe(1000);
    expect(resolveUnit('litre').mult).toBe(1000);
  });
  it('handles "kilogram"', () => {
    expect(resolveUnit('kilogram').mult).toBe(1000);
  });
  it('handles "piece" / "pc"', () => {
    expect(resolveUnit('piece').mult).toBe(1);
    expect(resolveUnit('pc').mult).toBe(1);
  });
  it('falls back to mult=1 for unknown units', () => {
    expect(resolveUnit('bottles').mult).toBe(1);
  });
  it('handles empty/undefined', () => {
    expect(resolveUnit('').mult).toBe(1);
    expect(resolveUnit(undefined).mult).toBe(1);
  });
});

describe('displayToBase: human → storage conversion', () => {
  it('1 L of milk = 1000 ml stored', () => {
    expect(displayToBase(1, 'L')).toBe(1000);
  });
  it('1.5 L = 1500 ml', () => {
    expect(displayToBase(1.5, 'L')).toBe(1500);
  });
  it('5 kg of sugar = 5000 g stored', () => {
    expect(displayToBase(5, 'kg')).toBe(5000);
  });
  it('200 pcs = 200 pcs', () => {
    expect(displayToBase(200, 'pcs')).toBe(200);
  });
  it('500 g stays 500 g', () => {
    expect(displayToBase(500, 'g')).toBe(500);
  });
});

describe('baseToDisplayCost: per-base-unit → per-display-unit cost', () => {
  it('P0.07/ml × 1000 = P70/L (milk example)', () => {
    expect(baseToDisplayCost(0.07, 'L')).toBeCloseTo(70, 4);
  });
  it('P0.20/g × 1000 = P200/kg (sugar example)', () => {
    expect(baseToDisplayCost(0.20, 'kg')).toBeCloseTo(200, 4);
  });
  it('P8/pcs stays P8/pcs', () => {
    expect(baseToDisplayCost(8, 'pcs')).toBe(8);
  });
});

describe('round-trip integrity (no data loss)', () => {
  it('1L purchase at P70 → displayed back as 1L at P70/L', () => {
    const displayQty = 1;
    const displayCost = 70;
    const { mult } = resolveUnit('L');
    const storedQty = displayToBase(displayQty, 'L');
    const storedCostPerBase = displayCost / mult;
    expect(storedQty).toBe(1000);
    expect(storedCostPerBase).toBeCloseTo(0.07, 4);
    // Now reverse:
    expect(storedQty / mult).toBe(displayQty);
    expect(baseToDisplayCost(storedCostPerBase, 'L')).toBeCloseTo(displayCost, 4);
  });
});
