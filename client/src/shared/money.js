// Same rounding rule as server/lib/money.js (half away from zero, to the
// centavo), so a total previewed here is the total the server posts.
export function roundMoney(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  const sign = x < 0 ? -1 : 1;
  const r = Math.round(Number((Math.abs(x) * 100).toPrecision(15))) / 100;
  return r === 0 ? 0 : sign * r; // never -0
}
