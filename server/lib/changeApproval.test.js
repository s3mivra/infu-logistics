import { describe, it, expect } from 'vitest';
import { splitUpdate, checkStale, isGuarded, labelFor } from './changeApproval.js';

describe('isGuarded', () => {
  it('gates the money levers and nothing else', () => {
    expect(isGuarded('Product', 'basePrice')).toBe(true);
    expect(isGuarded('Product', 'costOverride')).toBe(true);
    // Paperwork stays out of the queue - see the module comment.
    expect(isGuarded('Product', 'name')).toBe(false);
    expect(isGuarded('Product', 'category')).toBe(false);
    // Superadmin-only routes are out of scope on purpose - see the module note.
    expect(isGuarded('Inventory', 'unitCost')).toBe(false);
    expect(isGuarded('Nonsense', 'basePrice')).toBe(false);
  });

  it('labels a field by what the number means, for the approver', () => {
    expect(labelFor('Product', 'costOverride')).toBe('Recipe cost override');
    expect(labelFor('Product', 'somethingElse')).toBe('somethingElse');
  });
});

describe('splitUpdate', () => {
  const existing = { name: 'Widget', basePrice: 250, costOverride: 100 };

  it('holds back a guarded change and applies the rest', () => {
    const { apply, pending } = splitUpdate({
      entity: 'Product', existing,
      update: { name: 'Widget Pro', basePrice: 300 },
      canApprove: false,
    });
    // The price is NOT written - that is the whole point of the gate.
    expect(apply).toEqual({ name: 'Widget Pro' });
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ field: 'basePrice', oldValue: 250, newValue: 300, label: 'Selling price' });
  });

  it('lets an approver write straight through', () => {
    const { apply, pending } = splitUpdate({
      entity: 'Product', existing,
      update: { basePrice: 300 },
      canApprove: true,
    });
    expect(apply).toEqual({ basePrice: 300 });
    expect(pending).toEqual([]);
  });

  it('ignores a "change" that changes nothing', () => {
    // Forms resubmit every field. Queueing a request for a price that was
    // never touched would bury the real ones.
    const { apply, pending } = splitUpdate({
      entity: 'Product', existing,
      update: { basePrice: 250, name: 'Widget' },
      canApprove: false,
    });
    expect(pending).toEqual([]);
    expect(apply).toEqual({ basePrice: 250, name: 'Widget' });
  });

  it('treats a numeric string from a form as the same number', () => {
    const { pending } = splitUpdate({
      entity: 'Product', existing,
      update: { basePrice: '250' },
      canApprove: false,
    });
    expect(pending).toEqual([]);
  });

  it('does not confuse an unset price with a zero one', () => {
    // Number(null) is 0, so a naive numeric compare would read "no cost set"
    // and "costed at zero" as the same value. They are opposites, and the
    // change between them must not slip past the gate.
    const { pending } = splitUpdate({
      entity: 'Product', existing: { costOverride: null },
      update: { costOverride: 0 },
      canApprove: false,
    });
    expect(pending).toHaveLength(1);
    expect(pending[0].newValue).toBe(0);
  });
});

describe('checkStale', () => {
  const change = { field: 'basePrice', oldValue: 250, newValue: 300 };

  it('is fresh while the value is still what the approver saw', () => {
    expect(checkStale(change, { basePrice: 250 })).toEqual({ stale: false });
  });

  it('flags a value that moved underneath the request', () => {
    // The approver agreed to 250 -> 300, not to 275 -> 300.
    const r = checkStale(change, { basePrice: 275 });
    expect(r.stale).toBe(true);
    expect(r.alreadyApplied).toBe(false);
    expect(r.currentValue).toBe(275);
  });

  it('reports an already-applied change as nothing left to do, not a conflict', () => {
    const r = checkStale(change, { basePrice: 300 });
    expect(r.stale).toBe(true);
    expect(r.alreadyApplied).toBe(true);
  });
});
