// One rounding rule for money, everywhere it is stored.
//
// Half away from zero, to the centavo - what a receipt, a BIR form and a
// person with a calculator all do. It used to be three rules: toFixed(2) and
// Math.round(x * 100) / 100 both round 1.005 DOWN to 1.00 (1.005 is really
// 1.00499999... in binary), while roundCentavo's EPSILON nudge rounded it up
// to 1.01 - and only for small amounts, since EPSILON vanishes against 1000.
// Trimming the scaled value to 15 significant digits (all a double really
// holds) before rounding removes that binary noise at any magnitude.
export function roundMoney(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  const sign = x < 0 ? -1 : 1;
  const r = Math.round(Number((Math.abs(x) * 100).toPrecision(15))) / 100;
  return r === 0 ? 0 : sign * r; // never -0
}

// Whole centavos, for comparing amounts exactly instead of within a tolerance.
export function toCentavos(n) {
  return Math.round(roundMoney(n) * 100);
}
