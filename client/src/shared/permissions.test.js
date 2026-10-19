import { describe, it, expect } from 'vitest';
import { effectivePermissions, togglePermission, pageLocked, screenFamilies } from './permissions.js';

// A slice of the real catalogue: one tab with three pages, one with two.
const CATALOG = [
  { key: 'accounting.view' },
  { key: 'reports.view' },
  { key: 'screen.ledger.journal', parent: 'accounting.view' },
  { key: 'screen.ledger.trial', parent: 'accounting.view' },
  { key: 'screen.ledger.pnl', parent: 'accounting.view' },
  { key: 'screen.reports.salessummary', parent: 'reports.view' },
  { key: 'screen.reports.vatreturn', parent: 'reports.view' },
];
const LEDGER = ['screen.ledger.journal', 'screen.ledger.trial', 'screen.ledger.pnl'];

describe('reading a stored list', () => {
  it('groups pages by their tab', () => {
    expect(Object.keys(screenFamilies(CATALOG))).toEqual(['screen.ledger.', 'screen.reports.']);
  });

  it('opens every page of a tab when none is named - how every older role reads', () => {
    const eff = effectivePermissions(['accounting.view'], CATALOG);
    for (const k of LEDGER) expect(eff.has(k)).toBe(true);
    expect(eff.has('screen.reports.vatreturn')).toBe(false);
  });

  it('opens only the named pages once one is named', () => {
    const eff = effectivePermissions(['accounting.view', 'screen.ledger.trial'], CATALOG);
    expect(LEDGER.filter((k) => eff.has(k))).toEqual(['screen.ledger.trial']);
  });

  it('never opens a page whose tab is closed', () => {
    const eff = effectivePermissions(['screen.ledger.trial'], CATALOG);
    expect(eff.has('screen.ledger.trial')).toBe(false);
  });
});

describe('clicking a checkbox', () => {
  it('unticking one page leaves the rest open', () => {
    const next = togglePermission(['accounting.view'], 'screen.ledger.pnl', CATALOG);
    const eff = effectivePermissions(next, CATALOG);
    expect(LEDGER.filter((k) => eff.has(k))).toEqual(['screen.ledger.journal', 'screen.ledger.trial']);
  });

  it('ticking the last closed page back stores the tab as whole again', () => {
    const narrowed = togglePermission(['accounting.view'], 'screen.ledger.pnl', CATALOG);
    expect(togglePermission(narrowed, 'screen.ledger.pnl', CATALOG)).toEqual(['accounting.view']);
  });

  it('will not close the last open page - close the tab for that', () => {
    const one = ['accounting.view', 'screen.ledger.trial'];
    expect(pageLocked(one, 'screen.ledger.trial', CATALOG)).toBe(true);
    expect(togglePermission(one, 'screen.ledger.trial', CATALOG)).toBe(one);
  });

  it('locks every page of a closed tab', () => {
    expect(pageLocked([], 'screen.ledger.trial', CATALOG)).toBe(true);
    expect(togglePermission([], 'screen.ledger.trial', CATALOG)).toEqual([]);
  });

  it('closing a tab takes its page choices with it', () => {
    const next = togglePermission(['accounting.view', 'screen.ledger.trial', 'reports.view'], 'accounting.view', CATALOG);
    expect(next).toEqual(['reports.view']);
  });

  it('a plain permission is added and removed as before', () => {
    expect(togglePermission(['reports.view'], 'accounting.view', CATALOG)).toEqual(['reports.view', 'accounting.view']);
    expect(togglePermission(['reports.view', 'accounting.view'], 'reports.view', CATALOG)).toEqual(['accounting.view']);
  });
});
