// The per-line arithmetic every re-pricing of an existing order shares.
//
// Editing an order (features/orders.js) and re-stamping VAT on open orders
// after a settings change (features/settings.js) both need the same figures,
// and each used to carry its own copy of this loop. They agreed, but only by
// care: a change to the discount rule in one would silently re-price orders
// differently in the other.
//
// A line's discount is the HIGHER of its server-resolved product/client rate
// (productDiscountPercent) and any cashier per-line override (discountPercent)
// - never both. A line with its own discount, or one the cashier excluded
// (hasDiscount === false), is not eligible for an order-wide discount on top.
export function lineBases(items = []) {
  let totalGross = 0;
  let lineDiscTotal = 0;
  let baseAfterLineDisc = 0;
  let discountableBase = 0;
  let exemptBase = 0;
  for (const item of items) {
    const addOnTotal = (item.selectedAddOns || []).reduce((s, a) => s + Number(a.price || 0), 0);
    const itemBase = ((item.price || 0) + addOnTotal) * (item.quantity || 1);
    const linePct = Math.max(Number(item.productDiscountPercent || 0), Number(item.discountPercent || 0));
    const lineDisc = +(itemBase * linePct / 100).toFixed(2);
    totalGross += itemBase;
    lineDiscTotal += lineDisc;
    baseAfterLineDisc += itemBase - lineDisc;
    if (item.vatExempt === true) exemptBase += itemBase - lineDisc;
    if (linePct === 0 && item.hasDiscount !== false) discountableBase += itemBase;
  }
  return { totalGross, lineDiscTotal, baseAfterLineDisc, discountableBase, exemptBase };
}
