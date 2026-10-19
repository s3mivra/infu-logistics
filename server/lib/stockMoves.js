// What a sale took from stock, and what giving it back means.
//
// A sale records its stock moves on the order (Order.stockMoves): one entry
// per stock item it drew on, in base units, at the cost it left at, tagged
// with the order line it belongs to. A void, refund or exchange reverses those
// entries rather than reading the product's recipe again - the recipe may
// have changed since, and today's unit cost is not what the sale was booked at.
//
// Quantities are base units (g, ml, pcs). Everything is rounded to 6 decimal
// places, the same precision every other stock write in the app uses, so a
// long run of small moves does not collect float noise.

export const roundQty = (n) => +(Number(n) || 0).toFixed(6);

// From the stock-card rows a sale wrote (qtyChange negative = taken).
export function stockMovesFrom(cards = []) {
  return cards
    .filter((c) => c && c.inventoryId && Number(c.qtyChange) < 0)
    .map((c) => ({
      invId: String(c.inventoryId),
      qty: roundQty(-Number(c.qtyChange)),
      unitCost: Number(c.unitCost) || 0,
      lineIndex: Number.isInteger(c.lineIndex) ? c.lineIndex : null,
    }));
}

// The moves to give back.
//   lines omitted  -> the whole order (a void or a full refund)
//   lines given    -> [{ lineIndex, qty }]: that many units of each line, as a
//                     share of the line's own moves (qty / line quantity)
// Moves for the same stock item are merged so each item is touched once.
export function movesToReturn(order, lines) {
  const moves = Array.isArray(order?.stockMoves) ? order.stockMoves : [];
  const picked = [];
  if (!lines) {
    for (const m of moves) picked.push({ invId: String(m.invId), qty: Number(m.qty) || 0, unitCost: Number(m.unitCost) || 0 });
  } else {
    for (const { lineIndex, qty } of lines) {
      const lineQty = Number(order.items?.[lineIndex]?.quantity) || 0;
      if (!(lineQty > 0) || !(qty > 0)) continue;
      const share = Math.min(1, qty / lineQty);
      for (const m of moves) {
        if (m.lineIndex !== lineIndex) continue;
        picked.push({ invId: String(m.invId), qty: (Number(m.qty) || 0) * share, unitCost: Number(m.unitCost) || 0 });
      }
    }
  }
  const byItem = new Map();
  for (const m of picked) {
    const cur = byItem.get(m.invId) || { invId: m.invId, qty: 0, value: 0 };
    cur.qty += m.qty;
    cur.value += m.qty * m.unitCost;
    byItem.set(m.invId, cur);
  }
  return [...byItem.values()]
    .map((m) => ({ invId: m.invId, qty: roundQty(m.qty), unitCost: m.qty > 0 ? m.value / m.qty : 0, value: +m.value.toFixed(4) }))
    .filter((m) => m.qty > 0);
}

// Does this order carry a record of what it took?
export const hasStockMoves = (order) => Array.isArray(order?.stockMoves) && order.stockMoves.length > 0;
