import { describe, it, expect } from 'vitest';
import { splitLeft, splitReady, splitPayload, newSplit } from './SplitPayEditor';

describe('a split payment', () => {
  it('is ready when two or more parts add up to the sale', () => {
    expect(splitReady(100000, [{ method: 'Cash', amount: 50000 }, { method: 'On Account', amount: '50000' }])).toBe(true);
  });
  it('is not ready short, over, or with a single part', () => {
    expect(splitLeft(100000, [{ method: 'Cash', amount: 60000 }, { method: 'On Account', amount: 30000 }])).toBe(10000);
    expect(splitReady(100000, [{ method: 'Cash', amount: 60000 }, { method: 'On Account', amount: 50000 }])).toBe(false);
    expect(splitReady(100000, newSplit(100000))).toBe(false);   // all cash, nothing on account yet
  });
  it('sends only the parts with an amount', () => {
    expect(splitPayload([{ method: 'Cash', amount: '500.004' }, { method: 'GCash', amount: 0 }])).toEqual([{ method: 'Cash', amount: 500 }]);
  });
});
