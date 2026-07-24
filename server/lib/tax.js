// Non-VAT percentage tax — pure computation, no DB. Unit-testable in isolation.
//
// Philippine non-VAT taxpayers owe percentage tax on GROSS RECEIPTS ACTUALLY
// RECEIVED. Our revenue account (410000) is booked gross-of-discount, so the report
// must subtract sales discounts to land on what the customer actually paid — which is
// exactly order.total (net of discounts). The base for the 3% is therefore the net
// collected amount; the gross and the discount line are shown so the figure reconciles.

export const PERCENTAGE_TAX_RATE = 0.03; // 3% — non-VAT percentage tax (NIRC §116)

// Inputs come straight from order aggregates:
//   netCollected = Σ order.total     (what was actually received, net of discounts)
//   discounts    = Σ order.discount  (sales discounts given)
// Gross-of-discount is derived (net + discounts) so the breakdown always reconciles.
export function computePercentageTax({ netCollected = 0, discounts = 0 } = {}) {
  const net = +(+netCollected || 0).toFixed(2);
  const disc = +(+discounts || 0).toFixed(2);
  const gross = +(net + disc).toFixed(2);                 // gross sales before discounts
  const taxDue = +(net * PERCENTAGE_TAX_RATE).toFixed(2); // 3% of NET collected (the base)
  return {
    grossSales: gross,
    discounts: disc,
    netCollected: net,   // = the taxable base (gross receipts received)
    rate: PERCENTAGE_TAX_RATE,
    taxDue,
  };
}
