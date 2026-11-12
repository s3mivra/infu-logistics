// Non-VAT percentage tax - pure computation, no DB. Unit-testable in isolation.
//
// Philippine non-VAT taxpayers owe percentage tax on GROSS RECEIPTS ACTUALLY
// RECEIVED. Our revenue account (410000) is booked gross-of-discount, so the report
// must subtract sales discounts to land on what the customer actually paid - which is
// exactly order.total (net of discounts). The base for the 3% is therefore the net
// collected amount; the gross and the discount line are shown so the figure reconciles.

import { roundMoney } from './money.js';

export const PERCENTAGE_TAX_RATE = 0.03; // 3% - non-VAT percentage tax (NIRC §116)

// Inputs come straight from order aggregates:
//   netCollected = Σ order.total     (what was actually received, net of discounts)
//   discounts    = Σ order.discount  (sales discounts given)
// Gross-of-discount is derived (net + discounts) so the breakdown always reconciles.
// Rounded with the ledger's own rule (lib/money.js, half away from zero):
// toFixed put 1.005 at 1.00 where every journal line says 1.01 (2026-11 audit,
// M108). A month whose refunds exceed its sales owes nothing - it is not a
// credit against another month - so the tax is never negative, and
// `negativeBase` says so out loud rather than leaving a minus sign to explain.
export function computePercentageTax({ netCollected = 0, discounts = 0 } = {}) {
  const net = roundMoney(netCollected);
  const disc = roundMoney(discounts);
  const gross = roundMoney(net + disc);                       // gross sales before discounts
  const taxDue = Math.max(0, roundMoney(net * PERCENTAGE_TAX_RATE)); // 3% of NET collected (the base)
  return {
    grossSales: gross,
    discounts: disc,
    netCollected: net,   // = the taxable base (gross receipts received)
    rate: PERCENTAGE_TAX_RATE,
    taxDue,
    negativeBase: net < 0,
  };
}
