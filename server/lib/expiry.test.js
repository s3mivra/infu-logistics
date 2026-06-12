import { describe, it, expect } from 'vitest';
import { soonestExpiry, sortBatchesFEFO, consumeBatches, addBatch, batchesTotal } from './expiry.js';

const D = (s) => new Date(s);

describe('soonestExpiry', () => {
  it('returns null for empty', () => {
    expect(soonestExpiry([])).toBeNull();
    expect(soonestExpiry(undefined)).toBeNull();
  });
  it('returns soonest expiry across all live batches', () => {
    const batches = [
      { qty: 5, expiryDate: D('2026-06-22') },
      { qty: 3, expiryDate: D('2026-06-15') },
      { qty: 7, expiryDate: D('2026-07-01') },
    ];
    expect(soonestExpiry(batches).toISOString()).toBe(D('2026-06-15').toISOString());
  });
  it('ignores empty batches', () => {
    const batches = [
      { qty: 0, expiryDate: D('2026-06-10') }, // depleted, ignore
      { qty: 5, expiryDate: D('2026-06-22') },
    ];
    expect(soonestExpiry(batches).toISOString()).toBe(D('2026-06-22').toISOString());
  });
  it('ignores batches without expiry', () => {
    const batches = [
      { qty: 5 },
      { qty: 3, expiryDate: D('2026-06-22') },
    ];
    expect(soonestExpiry(batches).toISOString()).toBe(D('2026-06-22').toISOString());
  });
});

describe('sortBatchesFEFO', () => {
  it('sorts oldest expiry first', () => {
    const batches = [
      { qty: 5, expiryDate: D('2026-07-01') },
      { qty: 3, expiryDate: D('2026-06-15') },
      { qty: 7, expiryDate: D('2026-06-22') },
    ];
    const sorted = sortBatchesFEFO(batches);
    expect(sorted.map(b => b.expiryDate.toISOString())).toEqual([
      D('2026-06-15').toISOString(),
      D('2026-06-22').toISOString(),
      D('2026-07-01').toISOString(),
    ]);
  });
  it('puts no-expiry batches last', () => {
    const batches = [
      { qty: 5 },
      { qty: 3, expiryDate: D('2026-06-15') },
    ];
    const sorted = sortBatchesFEFO(batches);
    expect(sorted[0].expiryDate.toISOString()).toBe(D('2026-06-15').toISOString());
    expect(sorted[1].expiryDate).toBeUndefined();
  });
});

describe('consumeBatches (FEFO)', () => {
  it('consumes from oldest first', () => {
    const batches = [
      { qty: 5, expiryDate: D('2026-06-22') },  // batch 2 (newer)
      { qty: 3, expiryDate: D('2026-06-15') },  // batch 1 (older)
    ];
    const result = consumeBatches(batches, 2);
    expect(result.consumed).toBe(2);
    expect(result.leftover).toBe(0);
    // Should have removed 2 from the older (June 15) batch
    expect(result.batches).toHaveLength(2);
    const june15 = result.batches.find(b => b.expiryDate.toISOString() === D('2026-06-15').toISOString());
    expect(june15.qty).toBe(1);
  });
  it('removes batches that hit zero', () => {
    const batches = [
      { qty: 5, expiryDate: D('2026-06-22') },
      { qty: 3, expiryDate: D('2026-06-15') },
    ];
    const result = consumeBatches(batches, 3);
    // Older batch is depleted, should be removed
    expect(result.batches).toHaveLength(1);
    expect(result.batches[0].expiryDate.toISOString()).toBe(D('2026-06-22').toISOString());
    expect(result.batches[0].qty).toBe(5);
  });
  it('spills into next batch when first is not enough', () => {
    const batches = [
      { qty: 5, expiryDate: D('2026-06-22') },
      { qty: 3, expiryDate: D('2026-06-15') },
    ];
    const result = consumeBatches(batches, 6);
    expect(result.consumed).toBe(6);
    expect(result.batches).toHaveLength(1);
    expect(result.batches[0].qty).toBe(2);
    expect(result.batches[0].expiryDate.toISOString()).toBe(D('2026-06-22').toISOString());
  });
  it('reports leftover when stock insufficient', () => {
    const batches = [{ qty: 3, expiryDate: D('2026-06-15') }];
    const result = consumeBatches(batches, 10);
    expect(result.consumed).toBe(3);
    expect(result.leftover).toBe(7);
    expect(result.batches).toHaveLength(0);
  });
  it('returns input when consume is 0 or negative', () => {
    const batches = [{ qty: 5, expiryDate: D('2026-06-15') }];
    expect(consumeBatches(batches, 0).batches).toEqual(batches);
    expect(consumeBatches(batches, -1).batches).toEqual(batches);
  });
});

describe('addBatch', () => {
  it('appends a new batch', () => {
    const batches = [{ qty: 5, expiryDate: D('2026-06-15') }];
    const updated = addBatch(batches, { qty: 3, expiryDate: D('2026-06-22'), reference: 'PO-1' });
    expect(updated).toHaveLength(2);
    expect(updated[1].qty).toBe(3);
    expect(updated[1].reference).toBe('PO-1');
  });
  it('ignores zero-qty batches', () => {
    const batches = [{ qty: 5, expiryDate: D('2026-06-15') }];
    expect(addBatch(batches, { qty: 0 })).toEqual(batches);
  });
  it('does not mutate input', () => {
    const batches = [{ qty: 5, expiryDate: D('2026-06-15') }];
    addBatch(batches, { qty: 3, expiryDate: D('2026-06-22') });
    expect(batches).toHaveLength(1);
  });
});

describe('batchesTotal', () => {
  it('sums all batch quantities', () => {
    const batches = [{ qty: 5 }, { qty: 3 }, { qty: 7.5 }];
    expect(batchesTotal(batches)).toBe(15.5);
  });
  it('handles empty/missing safely', () => {
    expect(batchesTotal([])).toBe(0);
    expect(batchesTotal(undefined)).toBe(0);
    expect(batchesTotal([{ qty: 0 }, {}])).toBe(0);
  });
});

describe('integration: real-world milk batch scenario', () => {
  it('two milk batches → soonest = batch 1, sales deplete batch 1 first', () => {
    // 1L milk received June 1, expires June 15
    let batches = addBatch([], { qty: 1000, expiryDate: D('2026-06-15'), receivedAt: D('2026-06-01') });
    // 2L milk received June 5, expires June 22
    batches = addBatch(batches, { qty: 2000, expiryDate: D('2026-06-22'), receivedAt: D('2026-06-05') });

    expect(batchesTotal(batches)).toBe(3000);
    expect(soonestExpiry(batches).toISOString()).toBe(D('2026-06-15').toISOString());

    // Use 800ml in a coffee
    const after800 = consumeBatches(batches, 800);
    expect(after800.batches).toHaveLength(2);
    expect(after800.batches.find(b => b.expiryDate.toISOString() === D('2026-06-15').toISOString()).qty).toBe(200);

    // Use another 500ml — exhausts batch 1, starts batch 2
    const after1300 = consumeBatches(after800.batches, 500);
    expect(after1300.batches).toHaveLength(1);
    expect(after1300.batches[0].expiryDate.toISOString()).toBe(D('2026-06-22').toISOString());
    expect(after1300.batches[0].qty).toBe(1700);
    // Soonest expiry should now flip to batch 2
    expect(soonestExpiry(after1300.batches).toISOString()).toBe(D('2026-06-22').toISOString());
  });
});
