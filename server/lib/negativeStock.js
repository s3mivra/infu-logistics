// Selling below zero: what a sale does when it would take more than the
// books say is on the shelf.
//
// The shelf and the books disagree more often than a shop would like - a
// delivery put away before it was received, a count that was off. Refusing
// the sale at the till leaves a customer waiting for paperwork; letting it go
// through silently leaves a negative balance nobody looks at, which then
// misleads Analytics -> Stock movement, the Suggested PO and Costing. So the
// business chooses (Settings key `negativeStockMode`):
//
//   warn   (default) the sale goes through; every stock-card line that left an
//          item below zero is flagged (StockCard.belowZero), the order keeps
//          the list (Order.belowZeroItems), and managers are told
//          (notifications feed + an `stockBelowZero` socket event). The fix is
//          a count - Inventory -> Below zero.
//   block  the sale is refused with the item named.
//
// Either way stock held for another client's order is never sold: going
// below zero is about the books being behind, not about taking goods
// promised to someone else.
//
// Nothing here changes how much a sale deducts or what it posts to the books.

export const NEGATIVE_STOCK_KEY = 'negativeStockMode';
export const NEGATIVE_STOCK_MODES = ['warn', 'block'];
export const NEGATIVE_STOCK_DEFAULT = 'warn';

export const cleanNegativeStockMode = (v) => (NEGATIVE_STOCK_MODES.includes(v) ? v : NEGATIVE_STOCK_DEFAULT);

export async function readNegativeStockMode(Settings, session = null) {
  const row = await Settings.findOne({ key: NEGATIVE_STOCK_KEY }).session(session).lean();
  return cleanNegativeStockMode(row?.value);
}

// The filter for the atomic deduction. `respectReserved`: the stock held for
// client orders is kept out of what can be sold (a normal sale). Routes that
// fulfil the order holding the reservation pass false, as they always did.
export function saleStockFilter(invId, qty, mode, { respectReserved = true } = {}) {
  const free = respectReserved ? { $subtract: ['$stockQty', { $ifNull: ['$reservedQty', 0] }] } : '$stockQty';
  const enough = { $gte: [free, qty] };
  if (mode === 'block') return { _id: invId, $expr: enough };
  if (!respectReserved) return { _id: invId };
  return { _id: invId, $expr: { $or: [{ $lte: [{ $ifNull: ['$reservedQty', 0] }, 0] }, enough] } };
}

// Appended to the refusal so the cashier knows it is a setting, not a fault.
export const blockedNote = (mode) => (mode === 'block' ? ' Selling below zero is turned off in Settings.' : '');

export const isBelowZero = (balance) => Number(balance) < -1e-9;

// Marks a stock-card line that left its item below zero and adds the item to
// `list` (one entry per item, its latest balance). Returns the card.
export function flagBelowZero(card, list) {
  if (!isBelowZero(card.balanceAfter)) return card;
  card.belowZero = true;
  if (list) {
    const key = String(card.inventoryId);
    const prev = list.find(x => x.invId === key);
    if (prev) prev.balanceAfter = card.balanceAfter;
    else list.push({ invId: key, itemName: card.itemName || '', balanceAfter: card.balanceAfter });
  }
  return card;
}
