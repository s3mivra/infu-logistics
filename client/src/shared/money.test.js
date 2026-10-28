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
