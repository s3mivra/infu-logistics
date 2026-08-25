// Multi-batch expiry helpers - FEFO (First Expired First Out).
// All quantities are in BASE units (g/ml/pcs). Display conversion is done in the UI.
//
// Some goods (roasted beans, etc.) never carry an expiry date at all - only a
// production/roast date. batchSortDate() is the rotation key used everywhere
// batches are ordered or consumed: expiryDate when known (true FEFO), else
// productionDate (FPFO - oldest produced goes out first), else null (sorts
// last - no date info at all means it never rotates ahead of dated stock).
function batchSortDate(b) {
  return b?.expiryDate ?? b?.productionDate ?? null;
}

// Returns the SOONEST expiry date across all non-empty batches.
// Falls back to null if there are no batches with stock. Production-date-only
// batches are NOT counted here - this drives the "expiry" badges/alerts
// specifically, not general freshness.
export function soonestExpiry(batches) {
  if (!Array.isArray(batches) || batches.length === 0) return null;
  const live = batches
    .filter(b => b && b.expiryDate && (b.qty || 0) > 0)
    .map(b => new Date(b.expiryDate).getTime());
  if (live.length === 0) return null;
  return new Date(Math.min(...live));
}

// Sort batches ascending by their rotation date (oldest first) - expiryDate
// when set, else productionDate, else last (see batchSortDate above).
export function sortBatchesFEFO(batches) {
  return [...batches].sort((a, b) => {
    const ad = batchSortDate(a); const bd = batchSortDate(b);
    const ax = ad ? new Date(ad).getTime() : Infinity;
    const bx = bd ? new Date(bd).getTime() : Infinity;
    return ax - bx;
  });
}

// Consume `qtyToConsume` from batches (FEFO, falling back to FPFO - see batchSortDate).
// Returns { batches: updatedArray, consumed: actualConsumed, leftover: unconsumed,
//           consumedDetail: [{ qty, expiryDate, productionDate }] - per-batch
//           breakdown of what was taken, in the order batches were drawn from
//           (oldest rotation date first) }.
// Removes batches that drop to zero.
export function consumeBatches(batches, qtyToConsume) {
  if (!qtyToConsume || qtyToConsume <= 0) return { batches: [...batches], consumed: 0, leftover: 0, consumedDetail: [] };
  const sorted = sortBatchesFEFO(batches);
  let remaining = qtyToConsume;
  const updated = [];
  const consumedDetail = [];
  for (const b of sorted) {
    if (remaining <= 0) { updated.push(b); continue; }
    const have = b.qty || 0;
    if (have <= 0) continue; // drop empty batches
    if (have <= remaining) {
      remaining -= have;
      consumedDetail.push({ qty: have, expiryDate: b.expiryDate ?? null, productionDate: b.productionDate ?? null });
      // batch fully consumed - do not add to `updated`
    } else {
      updated.push({ ...b, qty: +(have - remaining).toFixed(6) });
      consumedDetail.push({ qty: remaining, expiryDate: b.expiryDate ?? null, productionDate: b.productionDate ?? null });
      remaining = 0;
    }
  }
  return { batches: updated, consumed: qtyToConsume - remaining, leftover: remaining, consumedDetail };
}

// Consume `qtyToConsume` from the ONE batch matching `rotationDate` only - no FEFO
// spillover into other batches. Used when a movement (e.g. a transfer) is pinned
// to a specific lot instead of "oldest first". `rotationDate` is whatever
// batchSortDate() returned for that batch (an expiryDate, or a productionDate
// for goods with no expiry).
// Returns the same shape as consumeBatches.
export function consumeSpecificBatch(batches, rotationDate, qtyToConsume) {
  if (!qtyToConsume || qtyToConsume <= 0) return { batches: [...batches], consumed: 0, leftover: 0, consumedDetail: [] };
  const targetTime = rotationDate ? new Date(rotationDate).getTime() : null;
  let remaining = qtyToConsume;
  const consumedDetail = [];
  const updated = (batches || []).map(b => {
    if (remaining <= 0) return b;
    const bd = batchSortDate(b);
    const bTime = bd ? new Date(bd).getTime() : null;
    if (bTime !== targetTime) return b;
    const have = b.qty || 0;
    if (have <= 0) return b;
    const take = Math.min(have, remaining);
    remaining -= take;
    consumedDetail.push({ qty: take, expiryDate: b.expiryDate ?? null, productionDate: b.productionDate ?? null });
    return { ...b, qty: +(have - take).toFixed(6) };
  }).filter(b => (b.qty || 0) > 0);
  return { batches: updated, consumed: qtyToConsume - remaining, leftover: remaining, consumedDetail };
}

// Append a new batch (or merge into an existing one with same expiryDate +/- 1 day).
// Returns the new array; does not mutate input. expiryDate and productionDate are
// independent - a batch normally carries one or the other (never-expiring goods
// like beans use productionDate only), but both are accepted if given.
export function addBatch(batches, { qty, expiryDate, productionDate, receivedAt, reference, unitCost }) {
  if (!qty || qty <= 0) return [...batches];
  const newBatch = {
    qty: +qty,
    expiryDate: expiryDate ? new Date(expiryDate) : null,
    productionDate: productionDate ? new Date(productionDate) : null,
    receivedAt: receivedAt ? new Date(receivedAt) : new Date(),
    reference: reference || '',
    unitCost: unitCost || 0
  };
  return [...batches, newBatch];
}

// Sum of all batch quantities (sanity-check vs stockQty).
export function batchesTotal(batches) {
  if (!Array.isArray(batches)) return 0;
  return batches.reduce((s, b) => s + (b.qty || 0), 0);
}
