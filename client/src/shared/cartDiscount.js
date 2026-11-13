// A manual-order cart line's cashier discount, which is typed either as a
// percent (discountPercent) or as the unit price to charge (targetPrice).
// The price is kept as typed and the percent worked out from it whenever it
// is needed, so re-pricing the line (choosing a client or a price tier) keeps
// the price the cashier asked for. The server does the same conversion when
// the order is saved (PUT /api/orders/:id items[i].targetPrice).

export const cartUnitBase = (item) =>
  (Number(item.price) || 0) + (item.selectedAddOns || []).reduce((s, a) => s + (Number(a.price) || 0), 0);

export const hasTargetPrice = (item) =>
  item.targetPrice !== undefined && item.targetPrice !== null && item.targetPrice !== '' && Number.isFinite(Number(item.targetPrice));

// The percent off this line, 0 to 100.
export function cartLinePct(item) {
  if (hasTargetPrice(item)) {
    const base = cartUnitBase(item);
    if (base <= 0) return 0;
    return Math.min(100, Math.max(0, (1 - Number(item.targetPrice) / base) * 100));
  }
  return Math.min(100, Math.max(0, Number(item.discountPercent) || 0));
}

// What the line comes to after its cashier discount.
export function cartLineTotal(item) {
  const gross = cartUnitBase(item) * (Number(item.quantity) || 1);
  if (hasTargetPrice(item)) return Math.min(gross, Math.max(0, Number(item.targetPrice)) * (Number(item.quantity) || 1));
  return gross * (1 - cartLinePct(item) / 100);
}

// A typed price above the line's normal price is not a discount.
export const targetAboveNormal = (item) => hasTargetPrice(item) && Number(item.targetPrice) > cartUnitBase(item) + 0.005;
