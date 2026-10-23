// Billing arithmetic for the panel's report, kept pure so it can be tested
// without Docker. meta.billing = { monthlyFee, paidMonths: ['YYYY-MM'], billFrom? }.
// A client is billed for every calendar month from billFrom (or the month it
// was set up) up to and including the current one.
export const monthRe = /^\d{4}-\d{2}$/;

export function monthsBetween(fromYm, toYm) {
  const out = [];
  let [y, m] = fromYm.split('-').map(Number);
  const [ty, tm] = toYm.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

export function billingRow(meta, thisMonth) {
  const billing = meta?.billing || { monthlyFee: null, paidMonths: [] };
  const start = String(billing.billFrom || meta?.createdAt || '').slice(0, 7);
  // A start in the future (or unreadable) bills just this month.
  const months = monthRe.test(start) && start <= thisMonth ? monthsBetween(start, thisMonth) : [thisMonth];
  const paid = new Set(billing.paidMonths || []);
  const unpaid = months.filter((m) => !paid.has(m));
  const fee = billing.monthlyFee ?? null;
  return {
    monthlyFee: fee,
    billFrom: months[0],
    monthsBilled: months.length,
    paidThisMonth: paid.has(thisMonth),
    unpaidMonths: unpaid,
    outstanding: fee != null ? fee * unpaid.length : null,
    collected: fee != null ? fee * (months.length - unpaid.length) : null,
  };
}
