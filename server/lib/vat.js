// VAT - pure computation, no DB. Unit-testable in isolation.
//
// Prices can be treated two ways, chosen per business by the `vatInclusive` flag:
//
//   INCLUSIVE (default, Philippine retail convention): a ₱112 tag stays ₱112.
//     Enabling VAT never changes what the customer pays; it only *extracts* the
//     VAT already inside the price for the receipt and the BIR return.
//   EXCLUSIVE (common in B2B quoting): a ₱100 tag becomes ₱112. VAT is *added*
//     on top of the listed net price, so the total rises when VAT is on.
//
// A VAT-registered business owes 12% VAT and is NOT liable for the 3% percentage
// tax under NIRC §116 - the two are mutually exclusive. `vatEnabled` drives both:
// see computePercentageTax in ./tax.js, whose report is gated on the same flag.

export const DEFAULT_VAT_RATE = 0.12; // 12% - Philippine VAT (NIRC §106)

// SC/PWD ordering. For a PERCENTAGE discount the two are arithmetically identical
// - gross/(1+r)*(1-p) === gross*(1-p)/(1+r), multiplication commutes - and differ
// only in the discount figure printed on the receipt. For a FLAT peso discount
// they produce genuinely different totals, which is why this is a real setting
// and not cosmetic.
export const SC_PWD_ORDERS = ['vat-first', 'discount-first'];

const round2 = (n) => +(+n || 0).toFixed(2);

// Normalises whatever is sitting in the settings collection. Operators type the
// rate as a percentage ("12"), but a value already stored as a fraction (0.12)
// must not silently become 1200% - so anything < 1 is treated as a fraction.
export function normaliseVatRate(raw, fallback = DEFAULT_VAT_RATE) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  const rate = n >= 1 ? n / 100 : n;
  // A rate at or above 100% is always a typo; refuse it rather than produce
  // negative net sales.
  return rate >= 1 ? fallback : rate;
}

/**
 * Split a VAT-inclusive amount into its net and VAT parts.
 *
 * @param {number} grossInclusive  amount actually charged, VAT included
 * @param {number} rate            fractional rate, e.g. 0.12
 * @returns {{ net: number, vat: number, gross: number }}
 */
export function extractVat(grossInclusive, rate = DEFAULT_VAT_RATE) {
  const gross = round2(grossInclusive);
  const r = Number(rate) || 0;
  if (r <= 0) return { net: gross, vat: 0, gross };
  const net = round2(gross / (1 + r));
  // Derive VAT by subtraction, never by gross*r/(1+r) computed independently -
  // rounding the two halves separately is how a receipt ends up a centavo off
  // its own total.
  return { net, vat: round2(gross - net), gross };
}

/**
 * Add VAT on top of a VAT-exclusive (net) amount - the mirror of extractVat, for
 * the exclusive pricing mode where the tag price is net and VAT is added.
 *
 * @param {number} net   listed net amount, VAT not yet added
 * @param {number} rate  fractional rate, e.g. 0.12
 * @returns {{ net: number, vat: number, gross: number }}
 */
export function addVat(net, rate = DEFAULT_VAT_RATE) {
  const n = round2(net);
  const r = Number(rate) || 0;
  if (r <= 0) return { net: n, vat: 0, gross: n };
  const vat = round2(n * r);
  return { net: n, vat, gross: round2(n + vat) };
}

/**
 * The whole per-order VAT decision, in one place.
 *
 * @param {object}  o
 * @param {number}  o.grossInclusive  line total after product-level discounts, VAT-inclusive
 * @param {number}  [o.discountableGross]  portion of the above eligible for the
 *   order-level discount. Lines carrying their own product discount, and lines
 *   the cashier excluded via `hasDiscount: false`, are in `grossInclusive` but
 *   NOT here - the order-wide percentage must not touch them. Defaults to the
 *   full gross.
 * @param {number}  [o.exemptGross]   portion of `grossInclusive` made up of lines
 *   whose PRODUCT is classified VAT-exempt. Independent of `isVatExempt`, which
 *   exempts the whole sale (SC/PWD). A basket can mix both kinds, so the
 *   order-level discount is split pro rata by value between them.
 * @param {number}  o.discountPercent order-wide percentage discount (0-100)
 * @param {number}  o.flatDiscount    order-wide peso discount
 * @param {boolean} o.vatEnabled      is the business VAT-registered
 * @param {number}  o.vatRate         fractional rate
 * @param {boolean} o.isVatExempt     SC/PWD (or otherwise exempt) sale
 * @param {string}  o.scPwdOrder      'vat-first' | 'discount-first'
 * @param {boolean} [o.vatInclusive]  true (default): listed prices already contain
 *   VAT and it is extracted. false: listed prices are net and VAT is added on top,
 *   so the total rises. `grossInclusive` is read as the net base in that case.
 * @returns {{ total, vatAmount, vatableSales, vatExemptSales, discount, rate }}
 */
export function computeOrderVat({
  grossInclusive = 0,
  discountableGross = undefined,
  exemptGross = 0,
  discountPercent = 0,
  flatDiscount = 0,
  vatEnabled = false,
  vatRate = DEFAULT_VAT_RATE,
  isVatExempt = false,
  scPwdOrder = 'vat-first',
  vatInclusive = true,
} = {}) {
  const gross = round2(grossInclusive);
  const discBase = discountableGross === undefined ? gross : round2(discountableGross);
  const pct = Math.max(0, Math.min(100, Number(discountPercent) || 0));
  const flat = Math.max(0, Number(flatDiscount) || 0);
  const rate = vatEnabled ? (Number(vatRate) || 0) : 0;

  // Non-VAT business: behaves exactly as the system did before VAT existed -
  // discounts come off the gross and nothing is split out.
  if (!vatEnabled) {
    const discount = Math.min(pct > 0 ? round2(discBase * pct / 100) : flat, gross);
    return {
      total: round2(gross - discount),
      vatAmount: 0,
      vatableSales: 0,
      vatExemptSales: round2(gross - discount),
      discount: round2(discount),
      rate: 0,
    };
  }

  // VAT-EXCLUSIVE pricing: the listed price is net and VAT is added on top, so
  // the total rises when VAT is on. Kept separate from the inclusive path below
  // because the direction of the arithmetic - and the total the customer pays -
  // genuinely differs. SC/PWD ordering (vat-first/discount-first) is moot here:
  // there is no embedded VAT to sequence the discount against.
  if (!vatInclusive) {
    const discount = Math.min(pct > 0 ? round2(discBase * pct / 100) : flat, gross);

    if (isVatExempt) {
      // Price is already net; nothing to strip. Discount the net, no VAT added.
      const net = round2(gross - discount);
      return {
        total: net, vatAmount: 0, vatableSales: 0, vatExemptSales: net,
        discount: round2(discount), rate,
      };
    }

    const exempt = Math.max(0, Math.min(round2(exemptGross), gross));
    if (exempt > 0) {
      // Mixed basket: exempt goods stay net, VATable goods get VAT added. The
      // order-level discount is split pro rata by value, matching the inclusive path.
      const exemptShare = gross > 0 ? exempt / gross : 0;
      const exemptDisc = round2(discount * exemptShare);
      const exemptNet = round2(exempt - exemptDisc);
      const vatableNet = round2((gross - discount) - exemptNet);
      const { vat } = addVat(vatableNet, rate);
      return {
        total: round2(vatableNet + vat + exemptNet), vatAmount: vat,
        vatableSales: vatableNet, vatExemptSales: exemptNet,
        discount: round2(discount), rate,
      };
    }

    const vatableNet = round2(gross - discount);
    const { vat, gross: withVat } = addVat(vatableNet, rate);
    return {
      total: withVat, vatAmount: vat, vatableSales: vatableNet, vatExemptSales: 0,
      discount: round2(discount), rate,
    };
  }

  // VAT-exempt sale (SC/PWD). No output VAT is due, so the 12% is stripped and
  // the whole remainder is reported as exempt sales.
  if (isVatExempt) {
    if (scPwdOrder === 'discount-first') {
      // Discount off the VAT-inclusive price, then strip VAT from what remains.
      const discount = Math.min(pct > 0 ? round2(discBase * pct / 100) : flat, gross);
      const { net } = extractVat(gross - discount, rate);
      return {
        total: net, vatAmount: 0, vatableSales: 0, vatExemptSales: net,
        discount: round2(discount), rate,
      };
    }
    // BIR-correct default: strip VAT first, discount the VAT-less amount. The
    // discountable portion is stripped too, so the percentage lands on the same
    // VAT-less basis the customer is actually being charged.
    const { net } = extractVat(gross, rate);
    const netDiscBase = extractVat(discBase, rate).net;
    const discount = Math.min(pct > 0 ? round2(netDiscBase * pct / 100) : flat, net);
    return {
      total: round2(net - discount), vatAmount: 0, vatableSales: 0,
      vatExemptSales: round2(net - discount), discount: round2(discount), rate,
    };
  }

  // Ordinary sale. The customer pays the same as they always did; we only report
  // how much of it was VAT.
  const discount = Math.min(pct > 0 ? round2(discBase * pct / 100) : flat, gross);
  const total = round2(gross - discount);

  // Mixed basket: some lines are VAT-exempt goods (raw agricultural produce and
  // the like) sitting alongside VATable ones. BIR wants the two reported
  // separately, so the order-level discount is allocated pro rata by value -
  // charging it all to one side would misstate both figures.
  const exempt = Math.max(0, Math.min(round2(exemptGross), gross));
  if (exempt > 0) {
    const exemptShare = gross > 0 ? exempt / gross : 0;
    const exemptDisc = round2(discount * exemptShare);
    const exemptCollected = round2(exempt - exemptDisc);
    const vatableCollected = round2(total - exemptCollected);
    const { net, vat } = extractVat(vatableCollected, rate);
    return {
      total, vatAmount: vat, vatableSales: net, vatExemptSales: exemptCollected,
      discount: round2(discount), rate,
    };
  }

  const { net, vat } = extractVat(total, rate);
  return {
    total, vatAmount: vat, vatableSales: net, vatExemptSales: 0,
    discount: round2(discount), rate,
  };
}
