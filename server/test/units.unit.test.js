// Unit tests for the canonical unit convention (g / mL / pcs base storage).
import { describe, it, expect } from 'vitest';
import { UNIT_TO_BASE, UNIT_TABLE, unitTypeOf, resolveUnit, displayToBase } from '../lib/units.js';

describe('UNIT_TO_BASE (single source of truth)', () => {
  it('keeps the exact factors baseUnitsPerSale depends on (COGS-critical)', () => {
    // These values must not drift - they were previously duplicated in server.js.
    expect(UNIT_TO_BASE).toEqual({
      mg: 0.001, g: 1, kg: 1000,
      ml: 1, cl: 10, l: 1000,
      pcs: 1, pc: 1, pack: 1, unit: 1,
    });
  });
  it('stores mass in grams and volume in millilitres', () => {
    expect(UNIT_TO_BASE.kg).toBe(1000); // 1 kg = 1000 g
    expect(UNIT_TO_BASE.l).toBe(1000);  // 1 L  = 1000 mL
    expect(UNIT_TABLE.L.base).toBe('ml');
    expect(UNIT_TABLE.kg.base).toBe('g');
  });
});

describe('unitTypeOf - mass / volume / count are separate dimensions', () => {
  it('classifies mass units', () => {
    for (const u of ['g', 'kg', 'mg', 'GRAM', 'Kilogram']) expect(unitTypeOf(u)).toBe('mass');
  });
  it('classifies volume units', () => {
    for (const u of ['ml', 'L', 'cl', 'liter', 'Millilitre']) expect(unitTypeOf(u)).toBe('volume');
  });
  it('classifies everything else as count', () => {
    for (const u of ['pcs', 'pc', 'pack', 'unit', 'box', '']) expect(unitTypeOf(u)).toBe('count');
  });
  it('never crosses mass and volume', () => {
    expect(unitTypeOf('kg')).not.toBe(unitTypeOf('L'));
  });
});

describe('purchase-time conversion (single multiplier into base)', () => {
  it('buying 1 sack (25 kg) of beans adds 25000 g', () => {
    expect(displayToBase(25, 'kg')).toBe(25000);
  });
  it('buying 2 L of milk adds 2000 mL', () => {
    expect(displayToBase(2, 'L')).toBe(2000);
  });
  it('pcs convert 1:1', () => {
    expect(displayToBase(12, 'pcs')).toBe(12);
    expect(resolveUnit('pcs')).toEqual({ base: 'pcs', mult: 1 });
  });
});
