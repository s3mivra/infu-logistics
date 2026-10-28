// Same rounding rule as server/lib/money.js (half away from zero, to the
// centavo), so a total previewed here is the total the server posts.
export function roundMoney(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  const sign = x < 0 ? -1 : 1;
  const r = Math.round(Number((Math.abs(x) * 100).toPrecision(15))) / 100;
  return r === 0 ? 0 : sign * r; // never -0
}

// How every peso amount reads on screen: two decimals, grouped, and a minus
// in front of the sign for a negative ("−₱1,234.00", not "₱-1,234.00").
const PESO_FMT = new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function formatPeso(n) {
  const x = roundMoney(n);
  return `${x < 0 ? '−' : ''}₱${PESO_FMT.format(Math.abs(x))}`;
}
