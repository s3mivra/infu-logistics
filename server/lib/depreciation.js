// Straight-line depreciation, kept pure so the arithmetic can be tested
// without a database or a clock.
//
// Two rules matter more than the formula itself, because breaking either one
// produces a balance sheet that looks plausible and is wrong:
//
//   1. Accumulated depreciation NEVER exceeds cost minus salvage. An asset
//      cannot depreciate past what it is worth, and once it stops the expense
//      must stop too - otherwise a fully written-down machine keeps quietly
//      reducing profit every month forever.
//   2. Net book value NEVER falls below salvage. That is the floor by
//      definition.
//
// Periods are whole months. A part-month is not depreciated until it completes,
// which is the convention a small business's accountant will expect and is far
// easier to reconcile than a daily proration.

const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Depreciable base: what actually gets written off over the asset's life. */
export function depreciableBase({ acquisitionCost, salvageValue = 0 } = {}) {
  const cost = Number(acquisitionCost) || 0;
  const salvage = Math.max(0, Number(salvageValue) || 0);
  // A salvage value above cost would make the base negative and the asset
  // appreciate. Treated as "nothing to depreciate" rather than trusted.
  return money(Math.max(0, cost - salvage));
}

/** Straight-line charge for one whole month. */
export function monthlyDepreciation(asset = {}) {
  const months = Number(asset.usefulLifeMonths) || 0;
  if (months <= 0) return 0;
  return money(depreciableBase(asset) / months);
}

/** What the asset is carried at now. */
export function netBookValue(asset = {}) {
  const cost = Number(asset.acquisitionCost) || 0;
  const accum = Number(asset.accumulatedDepreciation) || 0;
  return money(cost - accum);
}

/** How much of the asset's life is already written off, 0..1. */
export function depreciatedFraction(asset = {}) {
  const base = depreciableBase(asset);
  if (base <= 0) return 1;
  return Math.min(1, (Number(asset.accumulatedDepreciation) || 0) / base);
}

/** Whole months from `from` to `to`, never negative. */
export function monthsBetween(from, to) {
  const a = new Date(from);
  const b = new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  // Only count a month once its day-of-month has actually come round.
  if (b.getDate() < a.getDate()) months -= 1;
  return Math.max(0, months);
}

/**
 * What is owed on this asset as of a date.
 *
 * Returns { months, amount, remaining, capped } where `capped` says the charge
 * was clipped to the remaining depreciable value - the caller surfaces that so
 * a short final period is visibly deliberate rather than looking like a
 * rounding error.
 */
export function depreciationDue(asset = {}, asOf = new Date()) {
  const none = { months: 0, amount: 0, remaining: 0, capped: false };
  if (!asset || asset.status === 'Disposed') return none;

  const base = depreciableBase(asset);
  const accum = Number(asset.accumulatedDepreciation) || 0;
  const remaining = money(Math.max(0, base - accum));
  if (remaining <= 0) return { ...none, remaining: 0 };

  const perMonth = monthlyDepreciation(asset);
  if (perMonth <= 0) return { ...none, remaining };

  const since = asset.lastDepreciationDate || asset.acquisitionDate;
  const months = monthsBetween(since, asOf);
  if (months <= 0) return { ...none, remaining };

  const raw = money(perMonth * months);
  // Rule 1: never write off more than is left.
  const amount = money(Math.min(raw, remaining));
  return { months, amount, remaining, capped: amount < raw };
}

/**
 * The asset as it would stand after posting `amount`.
 * Status is derived, never set by hand, so it cannot disagree with the numbers.
 */
export function applyDepreciation(asset = {}, amount = 0, asOf = new Date()) {
  const base = depreciableBase(asset);
  const accum = money(Math.min(base, (Number(asset.accumulatedDepreciation) || 0) + (Number(amount) || 0)));
  return {
    accumulatedDepreciation: accum,
    lastDepreciationDate: new Date(asOf),
    // Rule 2 in practice: at the floor, it is done.
    status: accum >= base - 0.005 && base > 0 ? 'Fully Depreciated' : 'Active',
    netBookValue: netBookValue({ ...asset, accumulatedDepreciation: accum }),
  };
}

/**
 * Disposal outcome: proceeds against what the asset is still carried at.
 * A positive result is a gain (other income), a negative one a loss (expense).
 */
export function disposalResult(asset = {}, proceeds = 0) {
  const nbv = netBookValue(asset);
  const got = money(proceeds);
  const diff = money(got - nbv);
  return {
    netBookValue: nbv,
    proceeds: got,
    gain: diff > 0 ? diff : 0,
    loss: diff < 0 ? money(-diff) : 0,
  };
}

/** A whole schedule, for showing an operator what to expect. */
export function schedule(asset = {}, periods = 12) {
  const perMonth = monthlyDepreciation(asset);
  const base = depreciableBase(asset);
  let accum = Number(asset.accumulatedDepreciation) || 0;
  const rows = [];
  for (let i = 1; i <= periods && accum < base - 0.005; i++) {
    const charge = money(Math.min(perMonth, base - accum));
    accum = money(accum + charge);
    rows.push({
      period: i, charge,
      accumulated: accum,
      netBookValue: money((Number(asset.acquisitionCost) || 0) - accum),
    });
  }
  return rows;
}
