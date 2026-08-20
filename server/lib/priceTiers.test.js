import { describe, it, expect } from 'vitest';
import { resolveTierPrice, resolveTierPercent } from './priceTiers.js';

const product = (over = {}) => ({ _id: 'p1', basePrice: 100, ...over });
const tier = (over = {}) => ({ pricingMode: 'percent', percent: 0, productPrices: [], ...over });

describe('resolveTierPrice: percent mode', () => {
  it('applies the flat percent off basePrice', () => {
    expect(resolveTierPrice(product(), tier({ percent: 15 }))).toBe(85);
  });
  it('clamps an out-of-range percent', () => {
    expect(resolveTierPrice(product(), tier({ percent: 500 }))).toBe(0);
    expect(resolveTierPrice(product(), tier({ percent: -10 }))).toBe(100);
  });
  it('0% is the full price', () => {
    expect(resolveTierPrice(product(), tier())).toBe(100);
  });
});

describe('resolveTierPrice: per_product mode', () => {
  it('returns the explicit row for a listed product', () => {
    const t = tier({ pricingMode: 'per_product', productPrices: [{ productId: 'p1', price: 72 }] });
    expect(resolveTierPrice(product(), t)).toBe(72);
  });
  it('returns null for a product with no row - not silently discounted', () => {
    const t = tier({ pricingMode: 'per_product', productPrices: [{ productId: 'other', price: 10 }] });
    expect(resolveTierPrice(product(), t)).toBe(null);
  });
  it('ignores the flat percent field entirely in this mode', () => {
    const t = tier({ pricingMode: 'per_product', percent: 50, productPrices: [{ productId: 'p1', price: 99 }] });
    expect(resolveTierPrice(product(), t)).toBe(99);
  });
  it('rejects a negative stored price defensively', () => {
    const t = tier({ pricingMode: 'per_product', productPrices: [{ productId: 'p1', price: -5 }] });
    expect(resolveTierPrice(product(), t)).toBe(0);
  });
});

describe('resolveTierPercent: the order-money-path bridge', () => {
  it('converts a per_product price into the equivalent percent off basePrice', () => {
    const t = tier({ pricingMode: 'per_product', productPrices: [{ productId: 'p1', price: 85 }] });
    expect(resolveTierPercent(product(), t)).toBe(15);
  });
  it('returns null (not 0) when the tier has no row for this product', () => {
    const t = tier({ pricingMode: 'per_product', productPrices: [] });
    expect(resolveTierPercent(product(), t)).toBe(null);
  });
  it('matches the percent-mode tier percent directly', () => {
    expect(resolveTierPercent(product(), tier({ percent: 20 }))).toBe(20);
  });
  it('a per_product price ABOVE basePrice yields 0%, never a negative discount', () => {
    const t = tier({ pricingMode: 'per_product', productPrices: [{ productId: 'p1', price: 150 }] });
    expect(resolveTierPercent(product(), t)).toBe(0);
  });
  it('a zero basePrice does not divide by zero', () => {
    expect(resolveTierPercent(product({ basePrice: 0 }), tier({ percent: 10 }))).toBe(0);
  });
});
