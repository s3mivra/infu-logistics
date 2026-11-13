// One item's stock movements for a day, grouped the way the Daily Inventory &
// Movement Report shows them. Quantities are in base units, signed as the
// stock card records them (+ in, - out).
//
//   purchases    Restock (purchase-order receipts, manual restocks), Initial
//   transfersIn  Transfer In  (from another location, or a linked branch)
//   transfersOut Transfer Out (shown as a positive number)
//   sales        Sale (net of any returned to stock; shown as a positive number)
//   other        everything else: adjustments, spoilage, production, stock
//                takes, unit corrections (signed)
//
// beginning is worked back from the ending balance through all of them, so the
// row always adds up: beginning + purchases + transfersIn - transfersOut
// - sales + other = ending. Before transfers, spoilage and production were
// counted, a day with any of them showed a wrong beginning balance.
export const PURCHASE_TYPES = new Set(['Restock', 'Initial']);

export function tallyMovements(history = [], ending = 0) {
  const t = { purchases: 0, transfersIn: 0, transfersOut: 0, sales: 0, other: 0 };
  for (const h of history) {
    const q = Number(h.qtyChange) || 0;
    if (PURCHASE_TYPES.has(h.type)) t.purchases += q;
    else if (h.type === 'Transfer In') t.transfersIn += q;
    else if (h.type === 'Transfer Out') t.transfersOut += -q;
    else if (h.type === 'Sale') t.sales += -q;
    else t.other += q;
  }
  const beginning = (Number(ending) || 0) - t.purchases - t.transfersIn + t.transfersOut + t.sales - t.other;
  return { ...t, beginning, ending: Number(ending) || 0 };
}

// The day's purchase and transfer lines, oldest first, for the report's detail
// sections.
export function movementLines(history = []) {
  const byTime = [...history].sort((a, b) => new Date(a.date) - new Date(b.date));
  return {
    purchases: byTime.filter((h) => PURCHASE_TYPES.has(h.type)),
    transfers: byTime.filter((h) => h.type === 'Transfer In' || h.type === 'Transfer Out'),
  };
}
