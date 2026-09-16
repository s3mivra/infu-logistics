// Where VAT lands in the ledger.
//
// lib/vat.js decides how much VAT is in a sale; this decides how it is POSTED.
// A VAT-registered business collects VAT on behalf of the BIR: the money is a
// liability from the moment it is collected, never revenue. Booking the gross
// amount to 410000 (what the app used to do whenever VAT was switched on)
// overstates sales and profit by the VAT and leaves nothing to remit from.
//
//   sale      DR cash/AR  gross     CR 410000 net     CR 230300 VAT
//   reversal  DR 410000 net  DR 230300 VAT           CR cash/AR gross
//
// Non-VAT businesses (vatAmount 0) post exactly as before: one revenue line.
export const OUTPUT_VAT = { code: '230300', name: 'Output VAT Payable' };
export const INPUT_VAT = { code: '170300', name: 'Input VAT (Creditable)' };

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// What an order's VAT is, as a share of one of its amounts. Used when only
// part of a sale moves - a refunded line, a partly fulfilled delivery - so the
// VAT reversed is proportional to the value reversed rather than recomputed
// from a rate that may have changed since.
export function vatShare(order = {}, amount) {
  const vat = Number(order.vatAmount) || 0;
  if (vat <= 0) return 0;
  // The VAT belongs to the sale's gross value (total + whatever was discounted
  // off it), which is the base the order's own VAT figure was derived from.
  const base = (Number(order.total) || 0) + (Number(order.discount) || 0) - (Number(order.deliveryFee) || 0);
  if (base <= 0) return 0;
  const share = r2((Number(amount) || 0) * (vat / base));
  // Never reverse more VAT than the sale carried.
  return Math.min(Math.abs(share), vat) * (share < 0 ? -1 : 1);
}

// VAT inside an amount charged at the current rate - for money that is not a
// share of an existing sale, such as the extra charged on an exchange. Under
// exclusive pricing the amount IS the net, so there is no VAT to extract from
// it (what the customer is charged is settled by the sale itself).
export function vatFromInclusive(amount, rate, inclusive = true) {
  const r = Number(rate) || 0;
  if (!(r > 0) || inclusive === false) return 0;
  const a = Number(amount) || 0;
  return r2(a - a / (1 + r));
}

// The VAT inside an order's delivery fee, if that business treats the charge
// as VATable. Zero for everyone else, which is how every order behaved before
// the option existed.
export function deliveryFeeVat(order = {}) {
  if (order.deliveryFeeVatable !== true) return 0;
  const rate = Number(order.vatRate) || 0;
  const fee = Number(order.deliveryFee) || 0;
  if (!(rate > 0) || fee <= 0) return 0;
  // Inclusive pricing: the VAT is already inside the fee. Exclusive: the fee is
  // net and the VAT rides on top, exactly as the goods do.
  return order.isVatInclusive === false ? r2(fee * rate) : r2(fee - fee / (1 + rate));
}

// Revenue + VAT lines for a sale of `gross` carrying `vatAmount` of VAT.
// `side` is 'credit' for a sale, 'debit' for a reversal (void, refund).
export function saleRevenueLines({ gross, vatAmount = 0, side = 'credit', revenueAccount = '410000', revenueName = 'Sales Revenue (Non-VAT)' }) {
  const g = r2(gross);
  const vat = Math.min(r2(vatAmount), g);
  const net = r2(g - vat);
  const line = (code, name, amount) => (side === 'credit'
    ? { accountCode: code, accountName: name, debit: 0, credit: amount }
    : { accountCode: code, accountName: name, debit: amount, credit: 0 });
  const lines = [];
  // A fully VAT-relieved line (a comp at zero value) posts nothing.
  if (net !== 0) lines.push(line(revenueAccount, vat > 0 ? 'Sales Revenue (VAT)' : revenueName, net));
  if (vat > 0) lines.push(line(OUTPUT_VAT.code, OUTPUT_VAT.name, vat));
  return lines;
}
