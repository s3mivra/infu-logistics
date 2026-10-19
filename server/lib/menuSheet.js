// The coded menu sheet: one row per size, ingredients keyed by stock code.
//
// A different, stricter shape from the free-text barista workbooks in
// recipeImport.js. Here the sheet is written in pairs of columns:
//
//   Category & Name | Base & Extra Size | <id> | <qty> | <id> | <qty> | … | Price
//   Espresso        | 2oz Hot           | Espresso Cup | 1 | G10002/Water | 20g/35ml | … | 99
//
// Within a pair, "/" separates several ingredients, and the two cells line up
// left to right: `G10002/Water` with `20g/35ml` means G10002 is 20 g and Water
// is 35 ml. An identifier that matches a stock CODE is that inventory item;
// anything else is a non-stock line (filtered water, a cup that is not tracked)
// recorded for the recipe but never deducted and never costed.
//
// Nothing here guesses. Where the sheet is ambiguous - a quantity for an
// ingredient that is not there, a code nobody recognises - it is reported for a
// human to look at, because a silently dropped ingredient is a drink that
// under-reports its cost forever.

// Excel turns "1/1" into a date. A barista writing "1/1" for a cup and a lid
// gets 46023 stored instead, and the original text is gone. The serial is
// recoverable though: read it back as a date and the month/day ARE the two
// numbers that were typed.
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const looksLikeExcelDate = (v) => typeof v === 'number' && v > 20000 && v < 80000 && Number.isInteger(v);

export function recoverMangledQuantities(value) {
  if (!looksLikeExcelDate(value)) return null;
  const d = new Date(EXCEL_EPOCH_UTC + value * 86400000);
  if (Number.isNaN(d.getTime())) return null;
  // Written as it was typed: day/month order is whatever the sheet's locale
  // used, and either way the two numbers are the two quantities.
  return [d.getUTCMonth() + 1, d.getUTCDate()].map(String);
}

// "20g" -> { qty: 20, unit: 'g' } · "0.7ml" -> { qty: 0.7, unit: 'ml' }
// "1" -> { qty: 1, unit: '' }, left for the caller to read as a count.
export function parseQuantity(text) {
  const raw = String(text == null ? '' : text).trim();
  if (!raw) return null;
  const m = raw.match(/^(-?\d+(?:\.\d+)?)\s*([a-zA-Z]*)$/);
  if (!m) return null;
  const qty = Number(m[1]);
  if (!Number.isFinite(qty)) return null;
  return { qty, unit: m[2].toLowerCase() };
}

const splitCell = (v) => String(v == null ? '' : v).split('/').map(s => s.trim()).filter(Boolean);
const blank = (v) => String(v == null ? '' : v).trim() === '';

/**
 * One (identifier, quantity) column pair into ingredient lines.
 *
 * Returns { lines, problems }. A pair whose two cells do not line up produces
 * NO lines and one problem: the sheet says something the reader cannot know.
 */
export function parseIngredientPair(idCell, qtyCell) {
  const problems = [];
  const ids = splitCell(idCell);
  if (ids.length === 0) return { lines: [], problems };

  // The quantity cell, either as written or recovered from Excel's date.
  let qtyParts = recoverMangledQuantities(qtyCell);
  let recovered = false;
  if (qtyParts) recovered = true;
  else qtyParts = splitCell(qtyCell);

  if (qtyParts.length === 0) {
    problems.push({ kind: 'missing-quantity', detail: `"${ids.join('/')}" has no quantity beside it.` });
    return { lines: [], problems };
  }
  if (qtyParts.length !== ids.length) {
    problems.push({
      kind: 'count-mismatch',
      detail: `"${ids.join('/')}" lists ${ids.length} ingredient(s) but "${String(qtyCell).trim()}" gives ${qtyParts.length} quantity(ies).`,
    });
    return { lines: [], problems };
  }

  const lines = [];
  ids.forEach((id, i) => {
    const parsed = parseQuantity(qtyParts[i]);
    if (!parsed) {
      problems.push({ kind: 'bad-quantity', detail: `Could not read "${qtyParts[i]}" as a quantity for "${id}".` });
      return;
    }
    lines.push({ ref: id, qty: parsed.qty, unit: parsed.unit, recoveredFromDate: recovered });
  });
  return { lines, problems };
}

// Columns 2..13 are six (identifier, quantity) pairs; 0 is the name or a
// category heading, 1 the size, and the last cell the price.
const FIRST_PAIR_COL = 2;
const PAIR_COUNT = 6;
const PRICE_COL = 14;

const isHeaderRow = (row) => /category/i.test(String(row?.[0] || '')) && /size/i.test(String(row?.[1] || ''));
// A heading for the section below it: a name on its own, nothing else on the row.
const isCategoryRow = (row) => !blank(row?.[0]) && row.slice(1).every(blank);

/**
 * Read the whole sheet into products, each with one size per row.
 *
 * `rows` is the raw array-of-arrays (header row included). A row with no name
 * continues the product above it as another size - that is how the sheet writes
 * a hot and an iced version of the same drink.
 */
export function parseMenuSheet(rows = []) {
  const products = [];
  let category = '';
  let current = null;

  rows.forEach((row, index) => {
    if (!Array.isArray(row) || row.every(blank)) return;
    if (isHeaderRow(row)) return;
    if (isCategoryRow(row)) { category = String(row[0]).trim(); current = null; return; }

    const name = String(row[0] || '').trim();
    const sizeName = String(row[1] || '').trim();
    const price = Number(row[PRICE_COL]);
    const problems = [];

    const lines = [];
    for (let p = 0; p < PAIR_COUNT; p++) {
      const col = FIRST_PAIR_COL + p * 2;
      if (blank(row[col]) && blank(row[col + 1])) continue;
      // A quantity with nothing to attach it to is as broken as the reverse.
      if (blank(row[col])) {
        problems.push({ kind: 'orphan-quantity', detail: `A quantity ("${String(row[col + 1]).trim()}") with no ingredient beside it.` });
        continue;
      }
      const { lines: got, problems: bad } = parseIngredientPair(row[col], row[col + 1]);
      lines.push(...got);
      problems.push(...bad);
    }

    if (name) {
      current = { name, category, sizes: [], problems: [] };
      products.push(current);
    }
    if (!current) {
      // A size row before any product name: nothing to attach it to.
      products.push({
        name: sizeName ? `(unnamed, row ${index + 1})` : `(row ${index + 1})`,
        category, sizes: [],
        problems: [{ kind: 'orphan-size', detail: 'This row has no product name, and no product above it to belong to.' }],
      });
      return;
    }

    if (!Number.isFinite(price)) {
      problems.push({ kind: 'missing-price', detail: `"${sizeName || current.name}" has no price.` });
    }
    current.sizes.push({
      name: sizeName || 'Regular',
      price: Number.isFinite(price) ? price : 0,
      row: index + 1,
      ingredients: lines,
    });
    current.problems.push(...problems);
  });

  return products;
}

/**
 * Turn parsed products into the shape /api/products/import-menu accepts, and
 * say how each ingredient resolved.
 *
 * `codeIndex` maps a lower-cased stock code to its inventory item. Anything not
 * in it is a non-stock line - which is the sheet's own rule: a code is stock, a
 * word is not.
 */
export function toImportRows(products, codeIndex = new Map()) {
  return products.map((p) => {
    const unresolved = new Set();
    const resolve = (list) => list.map((ing) => {
      const item = codeIndex.get(String(ing.ref).toLowerCase().trim());
      // A quantity written with no unit is a count of pieces - "1/1" against a
      // cup and a lid is one of each. Deliberately NOT falling back to the
      // item's own unit: that would read "1" against a gram-tracked item as one
      // gram, which is not what anybody at the bar wrote down.
      const unit = ing.unit || 'pcs';
      if (item) {
        return { name: item.itemCode || item.itemName, qty: ing.qty, unit, stock: true, matchedName: item.itemName };
      }
      // Not a code, so by the sheet's own convention it is a measured
      // ingredient that is not tracked as stock.
      unresolved.add(ing.ref);
      return { name: ing.ref, qty: ing.qty, unit, nonStock: true, stock: false };
    });

    const all = p.sizes.map(sz => ({
      name: sz.name, price: sz.price, row: sz.row, ingredients: resolve(sz.ingredients),
    }));

    // The first row of a drink is its BASE size, and the rest are the extra
    // sizes. Not a copy of the first into both: the register offers the base
    // size followed by the extras, so listing the first row in both places puts
    // "4oz Hot" on the menu twice and leaves two copies of one recipe to be
    // kept in step by hand.
    //
    // This also has to be the base rather than an extra, because a size recipe
    // REPLACES the base one at sale time instead of adding to it - an empty
    // base means a sale naming no size deducts nothing and books no cost.
    const [base, ...extras] = all;

    return {
      name: p.name,
      category: p.category,
      srp: base?.price ?? 0,
      baseSize: base?.name || '',
      ingredients: base?.ingredients ?? [],
      sizes: extras,
      problems: p.problems,
      nonStockNames: [...unresolved].sort(),
    };
  });
}
