import { describe, it, expect } from 'vitest';
import { findByCode } from './ScanBox';

const stock = [
  { _id: 1, itemCode: 'CUP-12', itemName: 'Paper Cup 12oz' },
  { _id: 2, itemCode: 'CUP-120', itemName: 'Paper Cup 120 pack' },
  { _id: 3, itemCode: '', itemName: 'Loose Sugar' },
];

describe('which item a scanned code means', () => {
  it('matches the whole code, whatever its case - never part of a longer one', () => {
    expect(findByCode(stock, 'cup-12')._id).toBe(1);        // not CUP-120
    expect(findByCode(stock, ' CUP-120 ')._id).toBe(2);
    expect(findByCode(stock, 'CUP')).toBeNull();
  });

  it('falls back to the exact name, for an item with no code', () => {
    expect(findByCode(stock, 'loose sugar')._id).toBe(3);
    expect(findByCode(stock, 'sugar')).toBeNull();
  });

  it('finds nothing for a blank scan', () => {
    expect(findByCode(stock, '')).toBeNull();
    expect(findByCode(stock, '   ')).toBeNull();
  });

  it('reads the code from wherever the list keeps it', () => {
    const lines = [{ key: 'a', l: { itemCode: 'BEAN-1', itemName: 'Beans' } }];
    expect(findByCode(lines, 'bean-1', { codeOf: (x) => x.l.itemCode, nameOf: (x) => x.l.itemName }).key).toBe('a');
  });
});
