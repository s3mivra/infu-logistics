// Cancelled sales must not be imported as revenue.
//
// These sheets are hand-kept billing statements: a cancelled sale is annotated,
// not deleted. Importing it books revenue for a sale that never happened, and
// because it arrives backdated it is easy to miss afterwards.
//
// The opposite error matters just as much. A "cancellation fee" IS real
// revenue, so the matcher must not simply look for "cancel".
import { describe, it, expect } from 'vitest';
import {
  isCancelledCell, isCancelledRow, isCancelledSheet, partitionCancelledGroups,
} from './backdateCancelled.js';

describe('a cell marked cancelled', () => {
  it('matches both spellings, in any case', () => {
    for (const v of ['CANCELLED', 'cancelled', 'Cancelled', 'CANCELED', 'canceled']) {
      expect(isCancelledCell(v)).toBe(true);
    }
  });

  it('matches a bare stamp, with or without brackets', () => {
    for (const v of ['CANCEL', 'cancel', '(CANCELLED)', ' ( cancelled ) ']) {
      expect(isCancelledCell(v)).toBe(true);
    }
  });

  it('matches the word inside a longer note', () => {
    expect(isCancelledCell('Order cancelled by client')).toBe(true);
    expect(isCancelledCell('INV-1042 CANCELLED')).toBe(true);
  });

  it('does NOT match a cancellation fee, which is real revenue', () => {
    // The over-matching failure: this is money actually earned.
    expect(isCancelledCell('Cancellation Fee')).toBe(false);
    expect(isCancelledCell('Late cancellation charge')).toBe(false);
  });

  it('does not match unrelated text or blanks', () => {
    for (const v of ['', '   ', null, undefined, 'Cappuccino', 'Cancel Culture Mug', 0, 250]) {
      expect(isCancelledCell(v)).toBe(false);
    }
  });
});

describe('a row', () => {
  it('is cancelled when any cell says so', () => {
    expect(isCancelledRow(['INV-1', 'Latte', 2, 120, 'CANCELLED'])).toBe(true);
    expect(isCancelledRow(['INV-1', 'Latte', 2, 120, ''])).toBe(false);
  });

  it('survives a ragged or empty row', () => {
    expect(isCancelledRow([])).toBe(false);
    expect(isCancelledRow(undefined)).toBe(false);
    expect(isCancelledRow([null, undefined, ''])).toBe(false);
  });
});

describe('a whole sheet', () => {
  const grid = [
    ['INFU COFFEE'],
    ['Transaction No.', 'INV-1042'],
    ['Terms of Payment', 'Cash'],
    ['Description', 'Qty', 'Unit Price'],   // header at index 3
    ['Latte', 2, 120],
    ['Muffin', 1, 90],
  ];

  it('is cancelled when the stamp is in the header block', () => {
    const stamped = [...grid];
    stamped[1] = ['Transaction No.', 'INV-1042', 'CANCELLED'];
    expect(isCancelledSheet(stamped, 3)).toBe(true);
  });

  it('is NOT cancelled when only a line item is annotated', () => {
    // A note beside one line applies to that line, not to the whole invoice -
    // voiding a good invoice because one item was dropped would be worse.
    const oneLine = [...grid];
    oneLine[4] = ['Latte', 2, 120, 'cancelled'];
    expect(isCancelledSheet(oneLine, 3)).toBe(false);
  });

  it('is not cancelled for a clean sheet', () => {
    expect(isCancelledSheet(grid, 3)).toBe(false);
  });

  it('handles a missing or leading header index', () => {
    expect(isCancelledSheet(grid, 0)).toBe(false);
    expect(isCancelledSheet(grid, -1)).toBe(false);
    expect(isCancelledSheet(undefined, 3)).toBe(false);
  });
});

describe('splitting parsed groups', () => {
  const groups = [
    { transNo: 'INV-1', client: 'Acme', items: [{ name: 'Latte' }] },
    { transNo: 'INV-2 CANCELLED', client: 'Beta', items: [{ name: 'Mocha' }] },
    { transNo: 'INV-3', client: 'Gamma (cancelled)', items: [{ name: 'Tea' }] },
    { transNo: 'INV-4', client: 'Delta', items: [{ name: 'Cancellation Fee' }] },
  ];

  it('drops groups marked on the transaction or the client', () => {
    const { kept, cancelled } = partitionCancelledGroups(groups);
    expect(cancelled.map(g => g.transNo)).toEqual(['INV-2 CANCELLED', 'INV-3']);
    expect(kept.map(g => g.transNo)).toEqual(['INV-1', 'INV-4']);
  });

  it('keeps a genuine cancellation fee', () => {
    const { kept } = partitionCancelledGroups(groups);
    expect(kept.some(g => g.transNo === 'INV-4')).toBe(true);
  });

  it('is empty for no input', () => {
    expect(partitionCancelledGroups()).toEqual({ kept: [], cancelled: [] });
  });
});
