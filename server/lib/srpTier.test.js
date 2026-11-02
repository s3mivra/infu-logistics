import { describe, it, expect } from 'vitest';
import { resolveTierUnitPrice } from './priceTiers.js';

// The SRP tier, once expanded (srpTier.js), is an ordinary per-product tier.
describe('SRP tier', () => {
  const tier = { pricingMode: 'per_product', srpMode: true, productPrices: [{ productId: 'p1', price: 150 }], productBulkBreaks: [] };
  it('charges the SRP, which may be above list', () => {
    expect(resolveTierUnitPrice({ _id: 'p1', basePrice: 120 }, [tier])).toBe(150);
  });
  it('leaves a product with no SRP at list price', () => {
    expect(resolveTierUnitPrice({ _id: 'p2', basePrice: 120 }, [tier])).toBeNull();
  });
});
