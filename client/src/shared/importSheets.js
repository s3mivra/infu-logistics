// Reading import sheets - the one place the app turns spreadsheet rows into
// what the server imports.
//
// Pure functions, no React and no browser APIs, so the server's round-trip
// tests import exactly this code instead of a hand-written copy of it. A copy
// in a test proves nothing once the real parser changes; this cannot drift,
// because there is only one.

// ── Inventory sheet ───────────────────────────────────────────────────────

// Matches trailing pack size in product name: "250G", "1KG", "750ML", "1.3KG", "2.5L".
// Also tolerates a trailing parenthetical note after the size, e.g. "1KG (NW)" -
// that note is preserved in the cleaned name, only the size token is stripped.
// Anchoring strictly to end-of-string without this meant "MATCHA POWDER 1KG (NW)"
// never matched at all (the "(NW)" broke the `$` anchor), silently dropping the
// row from import (no unit could be inferred → filtered out with zero warning).
//
// Groups: 1 the number, 2 the unit, 3 a "/pack"-style qualifier, 4 a note.
// The qualifier matters for pieces only - see PIECES below.
export const SHEET_PACK_SIZE_RE = /\s+([0-9]+(?:\.[0-9]+)?)\s*(kg|g|L|l|ml|pcs|pc|piece)(?:\s*\/\s*(pack|box|bag|sleeve|case|pk))?\b(\s*\([^)]*\))?\s*$/i;

// Strips ₱/commas/whitespace before parseFloat, so a currency- or
// thousands-formatted cell (e.g. "₱1,800.00") doesn't silently truncate
// at the first comma - parseFloat("1,800.00") alone reads as 1.
export const parseSheetNumber = (v) => {
  if (v === '' || v == null) return NaN;
  if (typeof v === 'number') return v;
  return parseFloat(String(v).replace(/[₱,\s]/g, ''));
};

// Excel date cells arrive in one of three shapes:
//  - a JS Date (cellDates:true recognized the cell's own date number-format)
//  - a raw serial day-number (Excel's 1899-12-30 epoch) when the cell holds a
//    date-looking value but ISN'T tagged with a date format - cellDates:true
//    can't convert what the file itself doesn't mark as a date, so this still
//    shows up as a bare number like 46572 and must be converted by hand
//  - plain text, when the cell was typed/formatted as text
// Stringifying a raw serial without this conversion is exactly what produced
// "1/1/46572" instead of 4/7/2027 - the number was read as a literal year.
export const sheetDateToIso = (v) => {
  if (v === '' || v == null) return '';
  if (v instanceof Date) {
    // cellDates:true builds this Date from a LOCAL wall-clock construction
    // (verified empirically against this exact xlsx version - NOT the UTC
    // construction some docs describe), so reading it back with
    // .toISOString() (UTC getters) silently rolls the date back a day for
    // any timezone ahead of UTC - e.g. Nov 1 (Philippines, UTC+8) became
    // Oct 31. Local getters undo exactly what was baked in, correctly,
    // regardless of the viewer's own timezone.
    if (isNaN(v.getTime())) return '';
    const yr = v.getFullYear(), mo = String(v.getMonth() + 1).padStart(2, '0'), da = String(v.getDate()).padStart(2, '0');
    return `${yr}-${mo}-${da}`;
  }
  if (typeof v === 'number') {
    // Pure UTC day-count arithmetic (Excel's serial has no timezone concept
    // at all) - self-consistent with .toISOString() below regardless of
    // viewer timezone, unlike the Date-object branch above. Do not "fix"
    // this one the same way; it isn't broken.
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
  }
  let s = String(v).trim();
  // A 2-digit year in a typed/text cell (e.g. "9/21/27") is read by
  // JS Date parsing as 19xx, not 20xx - new Date("9/21/27") is Sept 1927,
  // not 2027. Expand it before anything else touches this string.
  // Pivot at 50, same convention spreadsheets themselves use.
  const m2 = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/);
  if (m2) {
    const yy = parseInt(m2[3], 10);
    s = `${m2[1]}/${m2[2]}/${yy < 50 ? 2000 + yy : 1900 + yy}`;
  }
  // Every date column in these sheets is MM/DD/YYYY (confirmed - not
  // DD/MM). Convert straight to an unambiguous ISO YYYY-MM-DD here
  // instead of handing the raw "M/D/YYYY" text down the pipe for
  // something else to interpret later: `new Date("9/1/2026")` reads
  // as MM/DD in most engines, but the app also re-parses this same
  // string on the server, in preview diffing, and in date-string
  // comparisons - any one of those going through a differently
  // configured Date parser silently flips month/day (9/1 → Jan 9
  // instead of Sept 1). Doing the MM/DD→ISO conversion explicitly,
  // once, here, removes that ambiguity everywhere downstream.
  const m3 = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m3) {
    const mo = parseInt(m3[1], 10), da = parseInt(m3[2], 10), yr = parseInt(m3[3], 10);
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
      s = `${yr}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
    }
  }
  return s;
};

// One spreadsheet row (as sheet_to_json gives it) → one import row.
export const normaliseInventoryRow = (r) => {
  const parseNum = parseSheetNumber;
  const lower = {};
  for (const [k, v] of Object.entries(r)) lower[String(k).toLowerCase().trim()] = v;

  // Parse trailing pack-size from product name.
  // Capture both the number AND unit so we can compute total stock and unit cost per display unit.
  // e.g. "FILTER PHIL 250G" → packQty=250, packRawUnit='g' → hintedUnit='kg', packSizeInDisplay=0.25
  // e.g. "MONIN STRAWBERRY 750ML" → packQty=750, packRawUnit='ml' → hintedUnit='L', packSizeInDisplay=0.75
  const rawProduct = String(lower.product || lower.itemname || lower.item || lower.name || '').trim();
  const sizeMatch = rawProduct.match(SHEET_PACK_SIZE_RE);
  let cleanedName = rawProduct, hintedUnit = '', packSizeInDisplay = 1;
  // PIECES. A weight or a volume in a name is always a pack: "CONDENSED MILK
  // 377g | 10" is ten cans, because nobody counts milk in grams on a shelf. A
  // piece count is different. "12oz ICED CUPS 50pcs | 104" says what a sleeve
  // holds, but the 104 beside it is cups, counted one by one - and reading it as
  // 104 sleeves put 5,200 cups on the books at a fiftieth of their price.
  // Supplies ARE often counted by the pack, so the sheet says which it means:
  // "STRAW SMALL 100pcs/pack | 5" is five packs, 500 straws. No qualifier on a
  // piece size, and the number is the count.
  let looseCount = false;
  if (sizeMatch) {
    const trailingNote = sizeMatch[4] ? sizeMatch[4].trim() : '';
    cleanedName = (rawProduct.slice(0, sizeMatch.index).trim() + (trailingNote ? ' ' + trailingNote : '')).trim();
    const packQty = parseFloat(sizeMatch[1]);
    const rawU = sizeMatch[2].toLowerCase();
    if (rawU === 'g') {
      hintedUnit = 'kg'; packSizeInDisplay = packQty / 1000; // 250g → 0.25 kg
    } else if (rawU === 'kg') {
      hintedUnit = 'kg'; packSizeInDisplay = packQty;         // 1kg → 1 kg
    } else if (rawU === 'ml') {
      hintedUnit = 'L';  packSizeInDisplay = packQty / 1000; // 750ml → 0.75 L
    } else if (rawU === 'l') {
      hintedUnit = 'L';  packSizeInDisplay = packQty;         // 1L → 1 L
    } else if (['pc', 'pcs', 'piece'].includes(rawU)) {
      hintedUnit = 'pcs';
      if (sizeMatch[3]) packSizeInDisplay = packQty;   // "100pcs/pack": the number is packs
      else looseCount = true;                           // "50pcs": the number is pieces
    }
  }

  // "Qty Unit" may be combined ("10 L") or just a number ("100") representing package count
  let qty = 0, unitFromCol = '';
  const qtyUnitCell = String(lower['qty unit'] || lower['qty/unit'] || lower['quantity unit'] || '').trim();
  if (qtyUnitCell) {
    const m = qtyUnitCell.match(/^([0-9.,]+)\s*[|/\s]*\s*([A-Za-z]+)$/);
    if (m) {
      qty = parseNum(m[1]) || 0;
      unitFromCol = m[2];
    } else {
      const numOnly = parseNum(qtyUnitCell);
      if (!isNaN(numOnly)) qty = numOnly;
    }
  }
  if (!qty) qty = parseNum(lower.qty ?? lower.quantity ?? lower.stock ?? 0) || 0;
  if (!unitFromCol) unitFromCol = String(lower.unit || lower.displayunit || '').trim();

  // Normalise any unit that came directly from the column
  if (unitFromCol.toLowerCase() === 'g') unitFromCol = 'kg';
  else if (unitFromCol.toLowerCase() === 'ml') unitFromCol = 'L';
  else if (unitFromCol.toLowerCase() === 'l') unitFromCol = 'L';

  let unit = unitFromCol;

  // When the Qty column is a pure package count (no unit in column), multiply by pack size.
  // e.g. 100 packs × 0.25 kg/pack = 25 kg total.
  if (!unitFromCol && hintedUnit && packSizeInDisplay > 0) {
    qty = qty * packSizeInDisplay;
    unit = hintedUnit;
  } else if (!unit && hintedUnit) {
    unit = hintedUnit;
  }

  // Nothing to go on - no Unit column, no parseable size in the name. Don't
  // drop the row: default to pcs (no per-pack conversion needed) so the item
  // still gets created/updated, and flag it so it's clearly marked "SET SIZE"
  // for the user to fix later, same badge already used in the inventory list.
  const needsSize = !unit;
  if (needsSize) unit = 'pcs';

  const exp = lower['expiry date'] || lower['expiry'] || lower['expirydate'] || '';
  const expStr = sheetDateToIso(exp);

  // Production date - for goods with no real expiry (roasted beans, etc.).
  // Only meaningful when there's no expiry on the row.
  const prod = lower['production date'] || lower['production'] || lower['prod date'] || lower['proddate'] || lower['roast date'] || lower['roastdate'] || '';
  const prodStr = expStr ? '' : sheetDateToIso(prod);

  // SRP - strip ₱ symbol and commas
  const rawSrpCell = lower.srp ?? lower['selling price'] ?? lower['retail price'] ?? '';
  const srp = (rawSrpCell === '' || rawSrpCell == null) ? '' : parseNum(rawSrpCell);

  // Excel unit cost is per package. Convert to cost per display unit.
  // e.g. 200 per 250g pack → 200 / 0.25 kg = 800 per kg.
  const rawUnitCostCell = (lower['unit cost'] === '' || lower['unit cost'] == null)
    ? (lower.unitcost === '' || lower.unitcost == null ? '' : lower.unitcost)
    : lower['unit cost'];
  const rawUnitCost = rawUnitCostCell === '' ? '' : parseNum(rawUnitCostCell);
  const unitCost = (rawUnitCost !== '' && !isNaN(rawUnitCost) && !unitFromCol && hintedUnit && packSizeInDisplay > 0)
    ? rawUnitCost / packSizeInDisplay
    : rawUnitCost;

  return {
    itemCode: String(lower.code || lower.itemcode || '').trim(),
    itemName: cleanedName,
    displayUnit: unit,
    qty,
    unitCost,
    expiryDate: expStr,
    productionDate: prodStr,
    srp,
    // Per-qty (pack) size parsed from the name, e.g. "Milk 1L" → packSize 1.
    // null when the name carried no size hint (nothing to persist), and null
    // for a loose piece count, which is not a pack.
    packSize: sizeMatch && !looseCount ? packSizeInDisplay : null,
    // A piece count, not packs - and therefore NOT a packed item, even if an
    // earlier import made it one. The server clears the pack on this, which
    // is what lets a corrected sheet undo that earlier import.
    looseCount,
    // Read from the app's own export, which writes both as reference
    // columns. Without them a re-imported file lost every warning level
    // and storage place. Blank leaves the current value alone.
    lowStockThreshold: (() => {
      const v = lower['low stock at'] ?? lower.lowstockthreshold ?? lower['low stock'] ?? '';
      const n = parseNum(v);
      return v === '' || isNaN(n) ? '' : n;
    })(),
    stockLocation: String(lower.location ?? lower.stocklocation ?? '').trim(),
    // No unit/size could be determined anywhere - imported as pcs, but flagged
    // so the preview (and later the inventory list's SET SIZE badge) tells the
    // user this item still needs its real size added.
    _needsSize: needsSize,
  };
};

// A row with a Code but no Product is a category header ("COFFEE & TEA")
// when its Code is not item-code shaped; it applies to every row after it.
export const isCategoryHeaderCode = (code) => !!code && !/^[A-Z]\d+$/i.test(String(code));

// Import rows → the body POSTed to /api/inventory/import. Blank cells become
// undefined so the server leaves those fields as they are.
export const inventoryImportPayload = (rows) => ({
  items: rows.map(r => ({
    itemCode: r.itemCode || undefined,
    itemName: r.itemName,
    displayUnit: r.displayUnit,
    qty: r.qty,
    unitCost: r.unitCost === '' || r.unitCost === undefined ? undefined : r.unitCost,
    expiryDate: r.expiryDate || undefined,
    productionDate: r.productionDate || undefined,
    category: r.category || undefined,
    srp: r.srp === '' || r.srp === undefined ? undefined : r.srp,
    packSize: r.packSize == null ? undefined : r.packSize,
    looseCount: r.looseCount === true ? true : undefined,
    lowStockThreshold: r.lowStockThreshold === '' || r.lowStockThreshold === undefined ? undefined : r.lowStockThreshold,
    stockLocation: r.stockLocation || undefined,
  })),
});

// ── Menu sheet ────────────────────────────────────────────────────────────

// Case-insensitive header lookup, so "SRP", "Srp" and "srp" all work.
const menuCell = (r, key) => {
  const hit = Object.keys(r).find(k => String(k).toLowerCase().trim() === key);
  return hit === undefined ? '' : r[hit];
};

// Rows → one entry per drink, with its base ingredients and any sizes.
// `match(name, unit)` returns the stock item an ingredient resolves to (or
// null); it only drives the preview's matched / unmatched marks - the server
// does its own matching on import.
export const groupMenuRows = (rawRows, match = () => null) => {
  const byName = new Map(); // lowercased name -> entry
  const order = [];
  for (const r of rawRows) {
    const name = String(menuCell(r, 'product') || '').trim();
    if (!name) continue;
    // The Recipes export lists add-on recipes for reference. This sheet
    // has no add-on column, so taking those rows in would fold every
    // add-on ingredient into the drink's base recipe.
    if (/^add-on/i.test(String(menuCell(r, 'recipe') || '').trim())) continue;
    const key = name.toLowerCase();
    const srpRaw = menuCell(r, 'srp');
    const srp = srpRaw === '' || srpRaw == null ? NaN : Number(srpRaw);
    const sizeName = String(menuCell(r, 'size') || '').trim();
    const ingName = String(menuCell(r, 'ingredient') || '').trim();
    const qty = Number(menuCell(r, 'qty')) || 0;
    const unit = String(menuCell(r, 'unit') || '').trim();
    // Filtered water and the like: recorded on the recipe, never stock.
    const nonStock = /not from inventory/i.test(String(menuCell(r, 'stock link') || ''));
    if (!byName.has(key)) {
      byName.set(key, { category: String(menuCell(r, 'category') || 'Uncategorized').trim(), name, srp: 0, ingredients: [], sizes: [] });
      order.push(key);
    }
    const entry = byName.get(key);
    let target = entry;
    if (sizeName) {
      let sz = entry.sizes.find(x => x.name.toLowerCase() === sizeName.toLowerCase());
      if (!sz) { sz = { name: sizeName, price: 0, ingredients: [] }; entry.sizes.push(sz); }
      if (!isNaN(srp) && srp > 0) sz.price = srp;
      target = sz;
    } else if (!isNaN(srp) && srp > 0) {
      entry.srp = srp; // last non-empty SRP on the group wins
    }
    if (ingName) {
      const matched = nonStock ? null : match(ingName, unit);
      target.ingredients.push({
        name: ingName, qty, unit, nonStock,
        _matched: nonStock || !!matched,
        _matchName: nonStock ? 'Not from inventory' : (matched?.itemName || null),
      });
    }
  }
  return order.map(k => byName.get(k));
};

const menuLine = (i) => ({ name: i.name, qty: i.qty, unit: i.unit, nonStock: !!i.nonStock });

// Grouped drinks → the body POSTed to /api/products/import-menu.
export const menuImportPayload = (rows) => ({
  rows: rows.map(r => ({
    category: r.category, name: r.name, srp: r.srp,
    ingredients: (r.ingredients || []).map(menuLine),
    // From the sheet's Size column. Sent only when there is one, so a plain
    // menu sheet leaves a product's existing sizes untouched.
    ...(r.sizes?.length ? {
      sizes: r.sizes.map(sz => ({ name: sz.name, price: sz.price, recipe: (sz.ingredients || []).map(menuLine) })),
    } : {}),
  })),
});

// A header row → is this the sheet to import from? Used to find the right
// sheet in a multi-sheet workbook, instead of assuming the first.
export const isStockSheetHeader = (hdr) => {
  const h = (hdr || []).map(x => String(x ?? '').toLowerCase().trim());
  return (h.includes('product') || h.includes('itemname'))
    && (h.includes('qty unit') || h.includes('unit cost') || h.includes('unitcost'));
};
export const isMenuSheetHeader = (hdr) => {
  const h = (hdr || []).map(x => String(x ?? '').toLowerCase().trim());
  return h.includes('product') && h.includes('ingredient');
};
