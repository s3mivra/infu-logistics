// Pure price-tier resolution - no DB, fully unit-testable. Single source of
// truth for "what does this tier charge for this product", used by both the
// admin-facing pricing table (display) and the order money path (orders.js
// converts the result into an equivalent discount percent so it can reuse the
// existing server-authoritative discount machinery unchanged).

// Resolves the price a given tier charges for a given product.
//   percent mode     -> basePrice minus the tier's flat percent
//   per_product mode -> the tier's explicit price for this product, or null
//                        if the tier has no row for it (no rate from this tier)
export function resolveTierPrice(product, tier) {
  if (!product || !tier) return null;
  const base = Number(product.basePrice) || 0;
  if (tier.pricingMode === 'per_product') {
    const entry = (tier.productPrices || []).find(pp => String(pp.productId) === String(product._id));
    if (!entry) return null;
    return Math.max(0, Number(entry.price) || 0);
  }
  const pct = Math.max(0, Math.min(100, Number(tier.percent) || 0));
  return +(base * (1 - pct / 100)).toFixed(2);
}

// Same result, expressed as a discount percent off basePrice - the form the
// order money path needs so a per_product tier can flow through the existing
// percent-based discount pipeline (see productDiscPct in orders.js) instead of
// a second, parallel "set the line price directly" code path.
export function resolveTierPercent(product, tier) {
  const base = Number(product?.basePrice) || 0;
  if (base <= 0) return 0;
  const price = resolveTierPrice(product, tier);
  if (price === null) return null; // this tier has no rate at all for this product
  return Math.max(0, Math.min(100, +(100 - (price / base) * 100).toFixed(4)));
}
