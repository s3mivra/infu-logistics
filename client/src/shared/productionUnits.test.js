// The production batch that turned 1700 ml of milk into 1700 L of stock.
//
// Filing a batch offered a unit picker; confirming the actual yield ignored it
// and counted in "pieces" instead, taken from the pack size in the item's name.
// So a batch filed as 1700 ml was shown back as "planned 1.7 pcs". The operator
// retyped the 1700 they had in mind, it was multiplied by the 1000 ml pack, and
// a thousand times the real quantity landed in stock.
import { describe, it, expect } from 'vitest';
import {
  reconcileUnitOptions, plannedUnitChoice, toBaseQty, inUnit, restateQty,
} from './productionUnits.js';

// "SPANISH MILK 1L" - base unit ml, sold in 1 L cartons, so its own unit list
// reads pieces first, then litres, then millilitres.
const MILK_OPTIONS = [
  { label: 'pcs', factor: 1000 },
  { label: 'L', factor: 1000 },
  { label: 'ml', factor: 1 },
];

const milkBatch = (overrides = {}) => ({
  outputType: 'existing',
  outputUnit: 'ml',
  outputQty: 1700,            // always base units: 1700 ml
  outputEnteredUnit: 'ml',
  ...overrides,
});

describe('confirming the yield of a batch planned in millilitres', () => {
  it('asks for it in millilitres, the unit it was planned in', () => {
    const choice = plannedUnitChoice(milkBatch(), MILK_OPTIONS);
    expect(choice.label).toBe('ml');
    expect(inUnit(1700, choice)).toBe(1700);      // not 1.7 "pcs"
  });

  it('adds 1700 ml to stock, not 1700 litres', () => {
    const choice = plannedUnitChoice(milkBatch(), MILK_OPTIONS);
    expect(toBaseQty(1700, choice)).toBe(1700);
    // The old reading multiplied the same 1700 by the 1000 ml pack.
    expect(toBaseQty(1700, choice)).not.toBe(1_700_000);
  });

  it('still lets the operator count in cartons if that is how it came out', () => {
    const pcs = MILK_OPTIONS[0];
    expect(toBaseQty(1.7, pcs)).toBe(1700);       // same real quantity
  });

  it('re-states the figure when the unit beside it changes', () => {
    const [pcs, litres, ml] = MILK_OPTIONS;
    expect(restateQty(1700, ml, litres)).toBe('1.7');
    expect(restateQty(1.7, litres, ml)).toBe('1700');
    expect(restateQty(1.7, litres, pcs)).toBe('1.7');
    // Whatever route it takes, the underlying quantity never moves.
    expect(toBaseQty(restateQty(1700, ml, pcs), pcs)).toBe(1700);
  });
});

describe('which units a yield may be counted in', () => {
  it('offers an existing item its own units', () => {
    expect(reconcileUnitOptions(milkBatch(), MILK_OPTIONS)).toEqual(MILK_OPTIONS);
  });

  it('offers a brand-new output the unit it was filed in', () => {
    const opts = reconcileUnitOptions({ outputType: 'new', outputUnit: 'g', outputPackSize: null });
    expect(opts).toEqual([{ label: 'g', factor: 1 }]);
  });

  it('adds pieces for a new output that has a pack size', () => {
    const opts = reconcileUnitOptions({ outputType: 'new', outputUnit: 'g', outputPackSize: 377 });
    expect(opts).toEqual([{ label: 'pcs', factor: 377 }, { label: 'g', factor: 1 }]);
    expect(toBaseQty(2, opts[0])).toBe(754);
  });

  it('never offers the same unit twice', () => {
    const opts = reconcileUnitOptions({ outputType: 'new', outputUnit: 'pcs', outputPackSize: 12 });
    expect(opts.map(o => o.label)).toEqual(['pcs']);
  });
});

describe('when the planned unit cannot be honoured', () => {
  it('falls back to the most natural reading for a batch filed before units were recorded', () => {
    const legacy = milkBatch({ outputEnteredUnit: '' });
    expect(plannedUnitChoice(legacy, MILK_OPTIONS).label).toBe('pcs');
  });

  it('falls back when the item no longer offers that unit', () => {
    // The carton was retired: the item is now tracked loose, in litres only.
    const nowLoose = [{ label: 'L', factor: 1000 }];
    expect(plannedUnitChoice(milkBatch(), nowLoose).label).toBe('L');
  });

  it('copes with an existing item whose units are not loaded yet', () => {
    const choice = plannedUnitChoice(milkBatch(), null);
    expect(choice.label).toBe('ml');   // from the order's own unit
    expect(toBaseQty(1700, choice)).toBe(1700);
  });
});

describe('quantities that are not numbers', () => {
  it('treats an empty or junk entry as nothing rather than NaN', () => {
    const ml = { label: 'ml', factor: 1 };
    expect(toBaseQty('', ml)).toBe(0);
    expect(toBaseQty('abc', ml)).toBe(0);
    expect(restateQty('', ml, ml)).toBe('');
  });

  it('does not accumulate floating-point dust across conversions', () => {
    const litres = { label: 'L', factor: 1000 };
    expect(toBaseQty(0.1, litres)).toBe(100);
    expect(inUnit(100, litres)).toBe(0.1);
  });
});
