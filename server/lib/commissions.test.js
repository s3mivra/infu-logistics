import { describe, it, expect } from 'vitest';
import { computeCommissions, tieredCommission, readCommissionRules } from './commissions.js';

const order = (seller, total, items) => ({ cashier: seller, total, items });
const users = [{ name: 'Ana', commissionRate: 5 }, { name: 'Ben', commissionRate: 0 }];

describe('commissions', () => {
  it('the person\'s own % on everything when no rules are set (as before)', () => {
    const r = computeCommissions({ orders: [order('Ana', 1000, [{ name: 'A', price: 1000, quantity: 1 }])], users });
    expect(r.sellers[0].commissionEarned).toBe(50);
  });

  it('a product rate beats its category rate, which beats the person\'s rate', () => {
    const { rules } = readCommissionRules({
      productRates: [{ productId: 'p1', name: 'Latte', rate: 10 }],
      categoryRates: [{ category: 'Drinks', rate: 3 }],
    });
    const cat = { p1: 'Drinks', p2: 'Drinks', p3: 'Food' };
    const o = order('Ana', 900, [
      { productId: 'p1', price: 300, quantity: 1 },   // share 270 x 10%
      { productId: 'p2', price: 300, quantity: 1 },   // share 270 x 3%
      { productId: 'p3', price: 400, quantity: 1 },   // share 360 x Ana's 5%
    ]);
    const r = computeCommissions({ orders: [o], users, rules, categoryOf: (id) => cat[id] });
    expect(r.sellers[0].commissionEarned).toBe(27 + 8.1 + 18);
  });

  it('tiers are marginal and apply to a seller with no own rate', () => {
    const { rules } = readCommissionRules({ tiers: [{ from: 0, rate: 2 }, { from: 50000, rate: 4 }] });
    expect(tieredCommission(80000, rules.tiers)).toBe(1000 + 1200);
    const r = computeCommissions({ orders: [order('Ben', 80000, []), order('Ana', 80000, [])], users, rules });
    expect(r.sellers.find((s) => s.name === 'Ben')).toMatchObject({ commissionEarned: 2200, rateSource: 'tiers' });
    expect(r.sellers.find((s) => s.name === 'Ana')).toMatchObject({ commissionEarned: 4000, rateSource: 'own' });
  });

  it('refunded units earn nothing; bad rates are refused', () => {
    const r = computeCommissions({ orders: [order('Ana', 500, [{ price: 500, quantity: 2, refundedQty: 1 }, { price: 0, quantity: 1 }])], users });
    expect(r.sellers[0].commissionEarned).toBe(25);
    expect(readCommissionRules({ categoryRates: [{ category: 'X', rate: 150 }] }).error).toBeTruthy();
    expect(readCommissionRules({ tiers: [{ from: 10, rate: 1 }, { from: 10, rate: 2 }] }).error).toBeTruthy();
  });
});
