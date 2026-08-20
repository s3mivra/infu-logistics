// SINGLE SOURCE OF TRUTH for "what discount does this buyer get on this
// product" - shared between the order money path (orders.js, at checkout)
// and every PRE-checkout price display (products.js's GET /api/products,
// read by both the POS product grid and the client portal menu). Never let
// these drift: a buyer shown one price must be charged exactly that price,
// not a second, subtly different calculation reached by a parallel copy of
// this logic.
import { resolveTierPercent } from './priceTiers.js';

// Loads the buyer's PRICE TIER context: the best flat percent among any
// 'percent'-mode tier they belong to, and every 'per_product'-mode tier they
// belong to (resolved per-product by the caller via resolveEffectiveDiscountPercent).
// Matched case-insensitively - the tag on the account and the tier name are
// entered in two different screens, and an exact-match miss here would
// silently charge a dealer full price. Only active tiers count.
export async function loadTierContext({ PriceTier, businessType, tenantScope, req, buyerSegments = [] }) {
  let tierDefaultPct = 0;
  let perProductTiers = [];
  if (!buyerSegments.length) return { tierDefaultPct, perProductTiers };
  try {
    const wanted = buyerSegments.map(s => String(s).trim().toLowerCase()).filter(Boolean);
    const tiers = await PriceTier.find(
      { businessType, ...tenantScope(req), isActive: true },
      { name: 1, percent: 1, pricingMode: 1, productPrices: 1 },
    ).lean();
    const hits = tiers.filter(t => wanted.includes(String(t.name).trim().toLowerCase()));
    const flatHits = hits.filter(t => t.pricingMode !== 'per_product');
    if (flatHits.length) tierDefaultPct = Math.max(0, Math.min(100, Math.max(...flatHits.map(t => Number(t.percent) || 0))));
    perProductTiers = hits.filter(t => t.pricingMode === 'per_product');
  } catch { /* ignore - no tier context applies */ }
  return { tierDefaultPct, perProductTiers };
}

// Resolves the discount percent for ONE product given an already-loaded buyer
// context. Precedence, most specific wins first:
//   1. per-client override on the product           - wins outright
//   2. buyer's per-product-priced tier for this SKU  - wins outright
//   3. per-product segment override                  - wins outright
//   4. max(product's flat default %, buyer's flat tier %)
// Quantity-break bulk pricing is NOT folded in here - it depends on a cart
// quantity this function has no line-item context for. Callers that DO know
// the quantity (orders.js) combine it separately via Math.max, same as before.
export function resolveEffectiveDiscountPercent(product, { buyerClientId = '', buyerSegments = [], tierDefaultPct = 0, perProductTiers = [] }) {
  if (!product) return 0;

  if (buyerClientId) {
    const ov = (product.clientDiscounts || []).find(d => String(d.clientId) === String(buyerClientId));
    if (ov) return Math.max(0, Math.min(100, Number(ov.percent || 0)));
  }

  if (perProductTiers.length) {
    const pcts = perProductTiers.map(t => resolveTierPercent(product, t)).filter(v => v !== null);
    if (pcts.length) return Math.max(0, Math.min(100, Math.max(...pcts)));
  }

  if (buyerSegments.length && (product.segmentDiscounts || []).length) {
    const matches = product.segmentDiscounts.filter(d => buyerSegments.includes(d.segment));
    if (matches.length) return Math.max(0, Math.min(100, Math.max(...matches.map(d => Number(d.percent || 0)))));
  }

  return Math.max(0, Math.min(100, Math.max(Number(product.discountPercent || 0), tierDefaultPct)));
}
