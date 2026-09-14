// Time-boxed sale pricing, in one place.
//
// The catalogue shows a product's sale price (products.js) and the order route
// charges it (orders.js). Both must read the same rules the same way, or a
// customer is shown one price and charged another.
//
// fixed_price  - the product sells at salePrice during the window
// percent_off  - basePrice less discountPercent, unless a fixed price also applies
// threshold    - order-level, not a unit price; returned separately
export function buildSalePriceMap(activeSales = []) {
  const map = {};              // productId -> { salePrice, salePercent, saleName }
  const thresholdRules = [];
  for (const sale of activeSales) {
    for (const rule of (sale.rules || [])) {
      if (rule.ruleType === 'threshold') {
        thresholdRules.push({ saleName: sale.name, productId: rule.productId, productName: rule.productName, thresholdAmount: rule.thresholdAmount, discountPercent: rule.discountPercent });
      } else if (rule.productId) {
        const pid = String(rule.productId);
        const existing = map[pid];
        // Last sale wins if multiple overlap.
        if (rule.ruleType === 'fixed_price') {
          map[pid] = { salePrice: rule.salePrice, saleName: sale.name, salePercent: null };
        } else if (rule.ruleType === 'percent_off' && !existing?.salePrice) {
          map[pid] = { salePercent: rule.discountPercent, saleName: sale.name, salePrice: null };
        }
      }
    }
  }
  return { map, thresholdRules };
}

// The unit price a product sells at right now, before any client discount.
export function saleUnitPrice(product, overlay) {
  if (!overlay) return null;
  if (overlay.salePrice != null) return Number(overlay.salePrice);
  if (overlay.salePercent != null) return +(Number(product.basePrice || 0) * (1 - overlay.salePercent / 100)).toFixed(2);
  return null;
}

export const activeSalesQuery = (now = new Date()) => ({ isActive: true, startsAt: { $lte: now }, endsAt: { $gte: now } });
