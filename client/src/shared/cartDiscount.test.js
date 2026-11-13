// A cart line discounted by a typed price or by a percent.
import { describe, it, expect } from 'vitest';
import { cartLinePct, cartLineTotal, hasTargetPrice, targetAboveNormal } from './cartDiscount.js';

const line = (extra = {}) => ({ price: 1800, quantity: 2, selectedAddOns: [], ...extra });

describe('cart line discount', () => {
  it('a percent works as before', () => {
    expect(cartLineTotal(line({ discountPercent: 10 }))).toBeCloseTo(3240, 2);
  });

  it('a typed price is charged exactly, per item', () => {
    const l = line({ discountMode: 'price', targetPrice: 1400 });
    expect(cartLineTotal(l)).toBe(2800);
    expect(cartLinePct(l)).toBeCloseTo(22.2222, 3);
  });

  it('counts add-ons in the normal price the typed price is measured against', () => {
    const l = line({ selectedAddOns: [{ price: 200 }], targetPrice: 1500, quantity: 1 });
    expect(cartLinePct(l)).toBeCloseTo(25, 6);
    expect(cartLineTotal(l)).toBe(1500);
  });

  it('keeps the typed price when the line is re-priced', () => {
    const l = line({ targetPrice: 1400 });
    expect(cartLineTotal({ ...l, price: 1700 })).toBe(2800);
  });

  it('an empty box is no discount, and a price above normal is flagged', () => {
    expect(hasTargetPrice(line({ targetPrice: null }))).toBe(false);
    expect(cartLineTotal(line({ targetPrice: null }))).toBe(3600);
    expect(targetAboveNormal(line({ targetPrice: 2000 }))).toBe(true);
    expect(cartLineTotal(line({ targetPrice: 2000 }))).toBe(3600);   // never above normal
  });
});
