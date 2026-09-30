// Pure price-tier resolution - no DB, fully unit-testable. Single source of
// truth for "what does this tier charge for this product", used by both the
// admin-facing pricing table (display) and the order money path (orders.js
// converts the result into an equivalent discount percent so it can reuse the
// existing server-authoritative discount machinery unchanged).

// The best (lowest) price this tier's quantity breaks offer THIS product at
// THIS quantity, or null if none qualify. `qty` is optional and defaults to
// "unknown" (0 items) - the static pre-checkout display has no cart quantity
// yet, so it never sees a break apply; only the order money path (which
// always knows the line's ordered quantity) passes a real one.
function resolveTierBulkBreakPrice(product, tier, qty = 0) {
  if (!product || !tier) return null;
  const breaks = (tier.productBulkBreaks || []).filter(b => String(b.productId) === String(product._id));
  if (!breaks.length) return null;
  const qualifying = breaks.filter(b => Number(qty) >= Number(b.minQty || 0));
  if (!qualifying.length) return null;
  return Math.max(0, Math.min(...qualifying.map(b => Math.max(0, Number(b.price) || 0))));
}

// Resolves the price a given tier charges for a given product.
//   percent mode     -> basePrice minus the tier's flat percent (quantity
//                        breaks are per_product-only, same as productPrices)
//   per_product mode -> the tier's explicit price for this product, or the
//                        better of it and any qualifying quantity break, or
//                        null if the tier has no rate here at all
export function resolveTierPrice(product, tier, qty = 0) {
  if (!product || !tier) return null;
  const base = Number(product.basePrice) || 0;
  if (tier.pricingMode === 'per_product') {
    const entry = (tier.productPrices || []).find(pp => String(pp.productId) === String(product._id));
    const flat = entry ? Math.max(0, Number(entry.price) || 0) : null;
    const bulk = resolveTierBulkBreakPrice(product, tier, qty);
    if (flat === null && bulk === null) return null;
    if (flat === null) return bulk;
    if (bulk === null) return flat;
    return Math.min(flat, bulk); // never stacked - whichever benefits the buyer more
  }
  const pct = Math.max(0, Math.min(100, Number(tier.percent) || 0));
  return +(base * (1 - pct / 100)).toFixed(2);
}

// A tier can charge MORE than the list price (a small-account or far-delivery
// rate: list ₱780, this client ₱896). The discount pipeline only goes down -
// a percent off the list price, never below 0% - so such a price was silently
// dropped back to list. Instead the tier price becomes the buyer's unit price
// and the discount stays 0%, so it never shows up as a negative "discount" in
// reports. Returns that unit price, or null when the buyer's best tier price is
// at or below list (the discount path already handles those).
// A per-client override on the product wins over any tier, same as the
// discount resolver, so that buyer keeps list-price-based pricing.
export function resolveTierMarkupPrice(product, perProductTiers = [], { buyerClientId = '', qty = 0 } = {}) {
  if (!product || !perProductTiers.length) return null;
  if (buyerClientId && (product.clientDiscounts || []).some(d => String(d.clientId) === String(buyerClientId))) return null;
  const base = Number(product.basePrice) || 0;
  const prices = perProductTiers.map(t => resolveTierPrice(product, t, qty)).filter(v => v !== null);
  if (!prices.length) return null;
  const best = Math.min(...prices);   // the buyer's best tier rate
  return best > base + 0.004 ? +best.toFixed(2) : null;
}

// Same result, expressed as a discount percent off basePrice - the form the
// order money path needs so a per_product tier can flow through the existing
// percent-based discount pipeline (see productDiscPct in orders.js) instead of
// a second, parallel "set the line price directly" code path.
export function resolveTierPercent(product, tier, qty = 0) {
  const base = Number(product?.basePrice) || 0;
  if (base <= 0) return 0;
  const price = resolveTierPrice(product, tier, qty);
  if (price === null) return null; // this tier has no rate at all for this product
  return Math.max(0, Math.min(100, +(100 - (price / base) * 100).toFixed(4)));
}
