import { describe, it, expect } from 'vitest';
import { roundMoney, toCentavos } from './money.js';

describe('roundMoney - one rule: half away from zero, to the centavo', () => {
  it('rounds the binary-inexact half-centavos up, at any magnitude', () => {
    // toFixed(2) and Math.round(x*100)/100 both gave 1.00 / 2.67 / 1000.00 here.
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(2.675)).toBe(2.68);
    expect(roundMoney(1000.005)).toBe(1000.01);
    expect(roundMoney(123456789.125)).toBe(123456789.13);
  });
  it('rounds negatives away from zero and never returns -0', () => {
    expect(roundMoney(-1.005)).toBe(-1.01);
    expect(Object.is(roundMoney(-0.004), 0)).toBe(true);
  });
  it('treats junk as zero', () => {
    expect(roundMoney(NaN)).toBe(0);
    expect(roundMoney(Infinity)).toBe(0);
    expect(roundMoney('abc')).toBe(0);
    expect(roundMoney(1e-9)).toBe(0);
  });
  it('toCentavos gives exact integers for comparing sides', () => {
    expect(toCentavos(0.1 + 0.2)).toBe(30);
    expect(toCentavos(1.005)).toBe(101);
  });
});
