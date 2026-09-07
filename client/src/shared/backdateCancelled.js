// Detecting a cancelled sale in a backdated-import spreadsheet.
//
// These sheets are billing statements a person maintained by hand, so a
// cancelled sale is usually not deleted - it is annotated. "CANCELLED" gets
// typed into a spare cell, stamped across the header block, or appended to the
// client name. Importing those rows books revenue for sales that never
// happened, and because it lands as a backdated entry it is easy to miss.
//
// The matcher is deliberately narrow. Over-matching is its own failure: a row
// legitimately describing a "cancellation fee" is real revenue and must still
// import, so a substring search for "cancel" is wrong.

// Whole word only, both spellings. "Cancellation" is NOT a match - that is a
// fee someone charged, not a sale that did not happen.
const CANCELLED_WORD = /\bcancell?ed\b/i;
// A bare stamp in an otherwise empty cell. Anchored, so it cannot fire on a
// sentence that merely contains the word.
const CANCELLED_STAMP = /^\s*\(?\s*cancell?(ed)?\s*\)?\s*$/i;

/** True when a single cell marks something cancelled. */
export function isCancelledCell(value) {
  const s = String(value ?? '').trim();
  if (!s) return false;
  return CANCELLED_STAMP.test(s) || CANCELLED_WORD.test(s);
}

/** True when any cell in the row marks it cancelled. */
export function isCancelledRow(row) {
  return (row || []).some(isCancelledCell);
}

/**
 * True when the sheet as a whole is marked cancelled.
 *
 * Only the label block ABOVE the item table is examined. Scanning the whole
 * grid would let one cancelled line item void an otherwise good invoice, which
 * is the opposite of what the annotation means - a stamp up top applies to the
 * document, a note beside a line applies to that line.
 */
export function isCancelledSheet(grid, headerIndex) {
  const end = Number.isInteger(headerIndex) && headerIndex >= 0 ? headerIndex : 0;
  for (let i = 0; i < end; i++) {
    if (isCancelledRow(grid?.[i])) return true;
  }
  return false;
}

/**
 * Split parsed groups into those to import and those to drop.
 *
 * A group is dropped when its transaction number or client carries the mark -
 * the case where someone wrote "INV-1042 CANCELLED" in the transaction column
 * rather than annotating each line.
 */
export function partitionCancelledGroups(groups = []) {
  const kept = [];
  const cancelled = [];
  for (const g of groups) {
    if (isCancelledCell(g?.transNo) || isCancelledCell(g?.client)) cancelled.push(g);
    else kept.push(g);
  }
  return { kept, cancelled };
}
