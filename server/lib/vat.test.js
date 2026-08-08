import { describe, it, expect } from 'vitest';
import { computeOrderVat, extractVat, addVat, normaliseVatRate, DEFAULT_VAT_RATE } from './vat.js';

describe('vat.normaliseVatRate', () => {
  it('accepts an operator-typed percentage', () => {
    expect(normaliseVatRate(12)).toBe(0.12);
    expect(normaliseVatRate('12')).toBe(0.12);
    expect(normaliseVatRate(8)).toBe(0.08);
  });

  it('accepts a value already stored as a fraction', () => {
    expect(normaliseVatRate(0.12)).toBe(0.12);
  });

  it('falls back rather than producing a nonsense rate', () => {
    expect(normaliseVatRate('abc')).toBe(DEFAULT_VAT_RATE);
    expect(normaliseVatRate(-5)).toBe(DEFAULT_VAT_RATE);
    expect(normaliseVatRate(150)).toBe(DEFAULT_VAT_RATE); // 150% is always a typo
    expect(normaliseVatRate(undefined)).toBe(DEFAULT_VAT_RATE);
  });
});

describe('vat.extractVat', () => {
  it('splits a VAT-inclusive amount', () => {
    const r = extractVat(112, 0.12);
    expect(r.net).toBe(100);
    expect(r.vat).toBe(12);
    expect(r.gross).toBe(112);
  });

  it('always reconciles: net + vat === gross', () => {
    // 33.33 is the classic case where computing both halves independently
    // leaves the receipt a centavo short of its own total.
    for (const amount of [33.33, 99.99, 1, 0.07, 1234.56]) {
      const r = extractVat(amount, 0.12);
      expect(+(r.net + r.vat).toFixed(2)).toBe(r.gross);
    }
  });

  it('is a no-op at rate 0', () => {
    expect(extractVat(100, 0)).toMatchObject({ net: 100, vat: 0 });
  });
});

describe('vat.addVat', () => {
  it('adds VAT on top of a net amount', () => {
    const r = addVat(100, 0.12);
    expect(r.net).toBe(100);
    expect(r.vat).toBe(12);
    expect(r.gross).toBe(112);
  });
  it('is a no-op at rate 0', () => {
    expect(addVat(100, 0)).toMatchObject({ net: 100, vat: 0, gross: 100 });
  });
});

describe('vat.computeOrderVat — VAT-EXCLUSIVE pricing', () => {
  it('adds VAT on top: a ₱100 net line becomes ₱112', () => {
    const r = computeOrderVat({ grossInclusive: 100, vatEnabled: true, vatRate: 0.12, vatInclusive: false });
    expect(r.vatableSales).toBe(100);
    expect(r.vatAmount).toBe(12);
    expect(r.total).toBe(112);
  });

  it('discounts the net, then adds VAT to what remains', () => {
    // ₱1000 net, 10% off = ₱900 net, +12% VAT = ₱1008.
    const r = computeOrderVat({ grossInclusive: 1000, discountPercent: 10, vatEnabled: true, vatRate: 0.12, vatInclusive: false });
    expect(r.discount).toBe(100);
    expect(r.vatableSales).toBe(900);
    expect(r.vatAmount).toBe(108);
    expect(r.total).toBe(1008);
    expect(+(r.vatableSales + r.vatAmount).toFixed(2)).toBe(r.total);
  });

  it('exempt sale adds no VAT — the net is the total', () => {
    const r = computeOrderVat({ grossInclusive: 500, vatEnabled: true, vatRate: 0.12, vatInclusive: false, isVatExempt: true });
    expect(r.total).toBe(500);
    expect(r.vatAmount).toBe(0);
    expect(r.vatExemptSales).toBe(500);
  });

  it('mixed basket adds VAT only to the vatable net and reconciles', () => {
    const r = computeOrderVat({ grossInclusive: 1000, exemptGross: 400, vatEnabled: true, vatRate: 0.12, vatInclusive: false });
    expect(r.vatExemptSales).toBe(400);   // exempt net, no VAT
    expect(r.vatableSales).toBe(600);     // vatable net
    expect(r.vatAmount).toBe(72);         // 12% of 600
    expect(r.total).toBe(1072);
    expect(+(r.vatableSales + r.vatAmount + r.vatExemptSales).toFixed(2)).toBe(r.total);
  });

  it('exclusive and inclusive agree on VAT but differ on total for the same net', () => {
    // ₱112 inclusive == ₱100 net + ₱12. Feed each its own basis.
    const inc = computeOrderVat({ grossInclusive: 112, vatEnabled: true, vatRate: 0.12, vatInclusive: true });
    const exc = computeOrderVat({ grossInclusive: 100, vatEnabled: true, vatRate: 0.12, vatInclusive: false });
    expect(inc.vatAmount).toBe(exc.vatAmount);       // both ₱12
    expect(inc.vatableSales).toBe(exc.vatableSales); // both ₱100
    expect(inc.total).toBe(112);
    expect(exc.total).toBe(112);
  });

  it('non-VAT business ignores the inclusive flag entirely', () => {
    const a = computeOrderVat({ grossInclusive: 100, vatEnabled: false, vatInclusive: false });
    const b = computeOrderVat({ grossInclusive: 100, vatEnabled: false, vatInclusive: true });
    expect(a).toEqual(b);
    expect(a.total).toBe(100);
  });
});

describe('vat.computeOrderVat — non-VAT business', () => {
  it('behaves exactly as before VAT existed: discount off gross, nothing split', () => {
    const r = computeOrderVat({ grossInclusive: 1000, discountPercent: 10, vatEnabled: false });
    expect(r.total).toBe(900);
    expect(r.vatAmount).toBe(0);
    expect(r.rate).toBe(0);
    expect(r.discount).toBe(100);
  });

  it('applies a flat discount and never goes negative', () => {
    const r = computeOrderVat({ grossInclusive: 50, flatDiscount: 200, vatEnabled: false });
    expect(r.total).toBe(0);
    expect(r.discount).toBe(50);
  });
});

describe('vat.computeOrderVat — VATable sale', () => {
  it('does NOT change what the customer pays when VAT is switched on', () => {
    const off = computeOrderVat({ grossInclusive: 1120, vatEnabled: false });
    const on = computeOrderVat({ grossInclusive: 1120, vatEnabled: true, vatRate: 0.12 });
    expect(on.total).toBe(off.total); // inclusive pricing — the whole point
    expect(on.vatAmount).toBe(120);
    expect(on.vatableSales).toBe(1000);
  });

  it('splits the DISCOUNTED total, not the gross', () => {
    // ₱1120 less 10% = ₱1008 collected; VAT is 12/112 of what was collected.
    const r = computeOrderVat({ grossInclusive: 1120, discountPercent: 10, vatEnabled: true, vatRate: 0.12 });
    expect(r.total).toBe(1008);
    expect(r.vatableSales).toBe(900);
    expect(r.vatAmount).toBe(108);
    expect(+(r.vatableSales + r.vatAmount).toFixed(2)).toBe(r.total);
  });

  it('honours a manually entered rate', () => {
    const r = computeOrderVat({ grossInclusive: 108, vatEnabled: true, vatRate: 0.08 });
    expect(r.total).toBe(108);
    expect(r.vatableSales).toBe(100);
    expect(r.vatAmount).toBe(8);
  });
});

describe('vat.computeOrderVat — SC/PWD exempt sale', () => {
  it('strips VAT and books nothing as VATable', () => {
    const r = computeOrderVat({
      grossInclusive: 1120, discountPercent: 20, vatEnabled: true,
      vatRate: 0.12, isVatExempt: true, scPwdOrder: 'vat-first',
    });
    // 1120 / 1.12 = 1000, less 20% = 800
    expect(r.total).toBe(800);
    expect(r.vatAmount).toBe(0);
    expect(r.vatableSales).toBe(0);
    expect(r.vatExemptSales).toBe(800);
    expect(r.discount).toBe(200); // 20% of the VAT-less 1000
  });

  it('percentage discounts: both orderings agree on the total, differ on the printed discount', () => {
    const base = {
      grossInclusive: 1120, discountPercent: 20, vatEnabled: true,
      vatRate: 0.12, isVatExempt: true,
    };
    const vatFirst = computeOrderVat({ ...base, scPwdOrder: 'vat-first' });
    const discFirst = computeOrderVat({ ...base, scPwdOrder: 'discount-first' });
    expect(discFirst.total).toBe(vatFirst.total);   // multiplication commutes
    expect(discFirst.discount).toBe(224);           // 20% of the VAT-inclusive 1120
    expect(vatFirst.discount).toBe(200);            // 20% of the VAT-less 1000
  });

  it('flat discounts: the ordering genuinely changes the total', () => {
    const base = {
      grossInclusive: 1120, discountPercent: 0, flatDiscount: 112,
      vatEnabled: true, vatRate: 0.12, isVatExempt: true,
    };
    const vatFirst = computeOrderVat({ ...base, scPwdOrder: 'vat-first' });
    const discFirst = computeOrderVat({ ...base, scPwdOrder: 'discount-first' });
    expect(vatFirst.total).toBe(888);   // 1000 − 112
    expect(discFirst.total).toBe(900);  // (1120 − 112) / 1.12
    expect(vatFirst.total).not.toBe(discFirst.total);
  });
});

describe('vat.computeOrderVat — partial discount base', () => {
  it('applies the order-wide percentage only to the eligible portion', () => {
    // ₱1000 of goods, but only ₱400 is eligible (the rest carries its own
    // product discount or was excluded by the cashier). 10% off ₱400 = ₱40.
    const r = computeOrderVat({
      grossInclusive: 1000, discountableGross: 400,
      discountPercent: 10, vatEnabled: false,
    });
    expect(r.discount).toBe(40);
    expect(r.total).toBe(960);
  });

  it('still splits VAT across the whole collected amount, not just the eligible part', () => {
    const r = computeOrderVat({
      grossInclusive: 1120, discountableGross: 0,
      discountPercent: 20, vatEnabled: true, vatRate: 0.12,
    });
    expect(r.discount).toBe(0);        // nothing was eligible
    expect(r.total).toBe(1120);
    expect(r.vatAmount).toBe(120);     // VAT is on everything collected
  });

  it('exempt sale discounts the VAT-less eligible base', () => {
    const r = computeOrderVat({
      grossInclusive: 1120, discountableGross: 560,
      discountPercent: 20, vatEnabled: true, vatRate: 0.12,
      isVatExempt: true, scPwdOrder: 'vat-first',
    });
    // eligible 560 → VAT-less 500 → 20% = 100 off the VAT-less 1000
    expect(r.discount).toBe(100);
    expect(r.total).toBe(900);
    expect(r.vatAmount).toBe(0);
  });
});

describe('vat.computeOrderVat — per-product exemption (mixed basket)', () => {
  it('splits a basket of VATable and exempt goods', () => {
    // ₱1120 VATable + ₱500 exempt produce = ₱1620 collected.
    const r = computeOrderVat({
      grossInclusive: 1620, exemptGross: 500,
      vatEnabled: true, vatRate: 0.12,
    });
    expect(r.total).toBe(1620);
    expect(r.vatExemptSales).toBe(500);   // exempt goods carry no VAT
    expect(r.vatableSales).toBe(1000);    // 1120 / 1.12
    expect(r.vatAmount).toBe(120);
    // the three reported figures must add back to what was collected
    expect(+(r.vatableSales + r.vatAmount + r.vatExemptSales).toFixed(2)).toBe(r.total);
  });

  it('allocates an order-wide discount pro rata across both kinds', () => {
    const r = computeOrderVat({
      grossInclusive: 1000, exemptGross: 400, discountPercent: 10,
      vatEnabled: true, vatRate: 0.12,
    });
    expect(r.discount).toBe(100);
    expect(r.total).toBe(900);
    expect(r.vatExemptSales).toBe(360);   // 400 less its 40 share of the discount
    expect(+(r.vatableSales + r.vatAmount + r.vatExemptSales).toFixed(2)).toBe(r.total);
  });

  it('an entirely exempt basket produces no VAT at all', () => {
    const r = computeOrderVat({
      grossInclusive: 800, exemptGross: 800, vatEnabled: true, vatRate: 0.12,
    });
    expect(r.vatAmount).toBe(0);
    expect(r.vatableSales).toBe(0);
    expect(r.vatExemptSales).toBe(800);
  });

  it('SC/PWD still exempts the whole sale, product flags notwithstanding', () => {
    const r = computeOrderVat({
      grossInclusive: 1120, exemptGross: 0, discountPercent: 20,
      vatEnabled: true, vatRate: 0.12, isVatExempt: true,
    });
    expect(r.vatAmount).toBe(0);
    expect(r.vatableSales).toBe(0);
  });

  it('ignores an exempt portion larger than the basket', () => {
    const r = computeOrderVat({
      grossInclusive: 500, exemptGross: 9999, vatEnabled: true, vatRate: 0.12,
    });
    expect(r.vatExemptSales).toBe(500);
    expect(r.vatableSales).toBe(0);
    expect(r.vatAmount).toBe(0);
  });
});

describe('vat.computeOrderVat — input safety', () => {
  it('survives missing and garbage input', () => {
    expect(computeOrderVat().total).toBe(0);
    expect(computeOrderVat({ grossInclusive: 'abc', vatEnabled: true }).total).toBe(0);
  });

  it('clamps an out-of-range discount percent', () => {
    const r = computeOrderVat({ grossInclusive: 100, discountPercent: 500, vatEnabled: false });
    expect(r.total).toBe(0);
    expect(r.discount).toBe(100);
  });
});
