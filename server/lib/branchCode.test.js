// Branch codes group a consolidated report at three levels: business, location,
// and the individual inventory. The interesting case throughout is two branches
// sharing ONE location - AC-A001 and AC-A002 - which is the whole reason the
// location level exists.
import { describe, it, expect } from 'vitest';
import {
  parseBranchCode,
  isValidBranchCode,
  formatBranchCode,
  nextBranchCode,
  groupByLocation,
  rollUpByLocation,
  UNASSIGNED,
} from './branchCode.js';

describe('parseBranchCode', () => {
  it('splits a code into business, location and sequence', () => {
    expect(parseBranchCode('AC-A001')).toMatchObject({
      valid: true, business: 'AC', location: 'A', sequence: 1, locationKey: 'AC-A',
    });
  });

  it('gives two branches at the same address the same location key', () => {
    expect(parseBranchCode('AC-A001').locationKey).toBe('AC-A');
    expect(parseBranchCode('AC-A002').locationKey).toBe('AC-A');
    // A different address must not collide with them.
    expect(parseBranchCode('AC-B001').locationKey).toBe('AC-B');
  });

  it('keeps different businesses apart even at the same location letter', () => {
    expect(parseBranchCode('AC-A001').locationKey).not.toBe(parseBranchCode('XY-A001').locationKey);
  });

  it('accepts lower case and surrounding space, normalising to upper', () => {
    expect(parseBranchCode('  ac-a001 ')).toMatchObject({ valid: true, raw: 'AC-A001', locationKey: 'AC-A' });
  });

  it('reads the sequence as a number, ignoring leading zeros', () => {
    expect(parseBranchCode('AC-A007').sequence).toBe(7);
    expect(parseBranchCode('AC-A010').sequence).toBe(10);
  });

  it('refuses anything that does not fit rather than guessing', () => {
    // Guessing a location would file real money under the wrong site.
    for (const bad of ['', '   ', 'AC', 'ACA001', 'AC_A001', 'AC-001', 'AC-A', 'AC-A00A', null, undefined]) {
      const p = parseBranchCode(bad);
      expect(p.valid).toBe(false);
      expect(p.locationKey).toBe(UNASSIGNED);
    }
  });

  it('exposes a simple validity check', () => {
    expect(isValidBranchCode('AC-A001')).toBe(true);
    expect(isValidBranchCode('nope')).toBe(false);
  });
});

describe('formatBranchCode', () => {
  it('zero-pads so codes sort correctly as text', () => {
    expect(formatBranchCode({ business: 'AC', location: 'A', sequence: 1 })).toBe('AC-A001');
    expect(formatBranchCode({ business: 'AC', location: 'A', sequence: 10 })).toBe('AC-A010');
    expect('AC-A001' < 'AC-A010').toBe(true);
  });

  it('upper-cases and round-trips through the parser', () => {
    const code = formatBranchCode({ business: 'ac', location: 'b', sequence: 3 });
    expect(code).toBe('AC-B003');
    expect(parseBranchCode(code)).toMatchObject({ business: 'AC', location: 'B', sequence: 3 });
  });

  it('returns empty for incomplete input', () => {
    expect(formatBranchCode({ business: 'AC', location: 'A' })).toBe('');
    expect(formatBranchCode({})).toBe('');
    expect(formatBranchCode()).toBe('');
  });
});

describe('nextBranchCode', () => {
  it('gives the next inventory at an EXISTING location', () => {
    // The headline case: a second counter opening at the same address.
    expect(nextBranchCode('AC', 'A', ['AC-A001'])).toBe('AC-A002');
    expect(nextBranchCode('AC', 'A', ['AC-A001', 'AC-A002'])).toBe('AC-A003');
  });

  it('starts a NEW location at 001', () => {
    expect(nextBranchCode('AC', 'B', ['AC-A001', 'AC-A002'])).toBe('AC-B001');
  });

  it('ignores codes belonging to another location or business', () => {
    expect(nextBranchCode('AC', 'A', ['AC-B009', 'XY-A009'])).toBe('AC-A001');
  });

  it('fills from the highest in use, not the count', () => {
    // A retired AC-A002 must not be handed out again.
    expect(nextBranchCode('AC', 'A', ['AC-A001', 'AC-A003'])).toBe('AC-A004');
  });

  it('ignores malformed entries', () => {
    expect(nextBranchCode('AC', 'A', ['junk', '', 'AC-A001'])).toBe('AC-A002');
  });
});

describe('groupByLocation', () => {
  const rows = [
    { branchCode: 'AC-B001', name: 'Riverside' },
    { branchCode: 'AC-A002', name: 'Mall Kiosk' },
    { branchCode: 'AC-A001', name: 'Mall Main' },
  ];

  it('puts branches sharing an address under one location', () => {
    const groups = groupByLocation(rows);
    const mall = groups.find(g => g.locationKey === 'AC-A');
    expect(mall.branches.map(b => b.name)).toEqual(['Mall Main', 'Mall Kiosk']); // by sequence
    expect(groups.find(g => g.locationKey === 'AC-B').branches).toHaveLength(1);
  });

  it('orders locations predictably', () => {
    expect(groupByLocation(rows).map(g => g.locationKey)).toEqual(['AC-A', 'AC-B']);
  });

  it('keeps an un-coded branch instead of dropping it', () => {
    // It still holds real money; dropping it would understate the totals.
    const groups = groupByLocation([...rows, { branchCode: '', name: 'Not set up yet' }]);
    const un = groups.find(g => g.locationKey === UNASSIGNED);
    expect(un.branches.map(b => b.name)).toEqual(['Not set up yet']);
    expect(groups[groups.length - 1].locationKey).toBe(UNASSIGNED); // always last
  });

  it('is empty for no input', () => {
    expect(groupByLocation([])).toEqual([]);
    expect(groupByLocation()).toEqual([]);
  });
});

describe('rollUpByLocation', () => {
  const rows = [
    { branchCode: 'AC-A001', netIncome: 1000, totalAssets: 5000 },
    { branchCode: 'AC-A002', netIncome: 250.5, totalAssets: 1200 },
    { branchCode: 'AC-B001', netIncome: 400, totalAssets: 900 },
  ];

  it('totals the branches at one address into a single location figure', () => {
    const groups = rollUpByLocation(rows, ['netIncome', 'totalAssets']);
    const mall = groups.find(g => g.locationKey === 'AC-A');
    expect(mall.branchCount).toBe(2);
    expect(mall.totals.netIncome).toBeCloseTo(1250.5, 2);
    expect(mall.totals.totalAssets).toBeCloseTo(6200, 2);
  });

  it('totals only the named fields', () => {
    const [g] = rollUpByLocation([{ branchCode: 'AC-A001', netIncome: 5, ignoreMe: 99 }], ['netIncome']);
    expect(g.totals).toEqual({ netIncome: 5 });
  });

  it('treats a missing figure as zero rather than NaN', () => {
    const groups = rollUpByLocation(
      [{ branchCode: 'AC-A001', netIncome: 10 }, { branchCode: 'AC-A002' }],
      ['netIncome'],
    );
    expect(groups[0].totals.netIncome).toBe(10);
  });

  it('rolls up un-coded branches under Unassigned', () => {
    const groups = rollUpByLocation([{ branchCode: 'zzz', netIncome: 42 }], ['netIncome']);
    expect(groups[0].locationKey).toBe(UNASSIGNED);
    expect(groups[0].totals.netIncome).toBe(42);
  });
});
