import { describe, it, expect } from 'vitest';
import { formatPeso } from './money.js';

describe('formatPeso', () => {
  it('two decimals, grouped, minus before the sign', () => {
    expect(formatPeso(1234.5)).toBe('₱1,234.50');
    expect(formatPeso(-1234.5)).toBe('−₱1,234.50');
    expect(formatPeso(0.005)).toBe('₱0.01');
    expect(formatPeso(undefined)).toBe('₱0.00');
    expect(formatPeso(-0.001)).toBe('₱0.00');
  });
});

// 2026-11 audit, M118: the split editor and the receipt round like the server.
import { splitLeft, splitPayload } from '../features/ledger/SplitPayEditor.jsx';
import { peso } from './receiptTemplate.js';
describe('client rounding matches the server', () => {
  it.each([[1.005, '1.01'], [1.015, '1.02'], [10.075, '10.08'], [2.675, '2.68'], [-0.005, '-0.01']])('%s prints as %s', (n, want) => {
    expect(peso(n)).toBe('&#x20B1;' + want);
  });
  it('a split of 1.005 + 0 leaves nothing over, the way the server sees it', () => {
    expect(splitPayload([{ method: 'Cash', amount: 1.005 }])[0].amount).toBe(1.01);
    expect(splitLeft(1.005, [{ method: 'Cash', amount: 1.005 }])).toBe(0);
  });
});
