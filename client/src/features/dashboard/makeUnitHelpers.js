// Showing stock in its display unit (mirrors server/lib/units.js).
// Moved out of AdminDashboard.jsx as it was. The dashboard calls this once per
// render and hands in what these functions read, so each one still sees
// that render's values exactly as it did inline.
export default function makeUnitHelpers(deps) {
  const {
    BUSINESS_TYPE,
  } = deps;

  // ============================================================
  // UNITS DISPLAY HELPER - base ↔ display conversion (mirrors server/lib/units.js)
  // ============================================================
  const UNIT_TABLE = {
    g:   { base: 'g',   mult: 1 },
    kg:  { base: 'g',   mult: 1000 },
    ml:  { base: 'ml',  mult: 1 },
    L:   { base: 'ml',  mult: 1000 },
    pcs: { base: 'pcs', mult: 1 },
  };
  const resolveUnitFE = (u) => {
    if (!u) return { base: 'pcs', mult: 1 };
    const k = String(u).trim();
    if (UNIT_TABLE[k]) return UNIT_TABLE[k];
    const low = k.toLowerCase();
    if (['l','liter','litre'].includes(low)) return UNIT_TABLE.L;
    if (['kg','kilogram'].includes(low))     return UNIT_TABLE.kg;
    if (['g','gram'].includes(low))          return UNIT_TABLE.g;
    if (['ml','milliliter'].includes(low))   return UNIT_TABLE.ml;
    if (['pcs','pc','piece'].includes(low))  return UNIT_TABLE.pcs;
    return { base: k, mult: 1 };
  };
  // Effective display unit + multiplier for any inventory item.
  // FORCED RULE: never display g or ml - auto-promote to kg / L.
  // Returns { unit, mult } - use everywhere that needs to convert base ↔ display.
  const effectiveDisplay = (item) => {
    const baseUnit = item.unit || '';
    let displayUnit = item.displayUnit;
    let mult = (item.unitMultiplier && item.unitMultiplier > 0) ? item.unitMultiplier : null;
    if (!displayUnit || displayUnit === 'g' || displayUnit === 'ml') {
      if (baseUnit === 'g')        { displayUnit = 'kg';  mult = mult || 1000; }
      else if (baseUnit === 'ml')  { displayUnit = 'L';   mult = mult || 1000; }
      else                          { displayUnit = baseUnit || 'pcs'; mult = mult || 1; }
    }
    return { unit: displayUnit, mult: mult || 1 };
  };
  // LOG 1:1 - the pack size (how much ONE purchased unit holds) drives cost-per-pack
  // and the "count of packages" stock display. Prefer the persisted item.packSize
  // field (set on import/edit - see server InventorySchema.packSize) since imports
  // now STRIP the size hint out of the item name (e.g. "Milk 1L" → name "Milk",
  // packSize 1). Only fall back to parsing the name for legacy items that still
  // carry their size embedded in it (pre-packSize-field imports).
  // unitCost is stored per base unit, so packCost = unitCost × packBaseUnits.
  const PACK_RE = /(\d+(?:\.\d+)?)\s*(mg|kg|g|ml|cl|l|pcs|pc|pack|unit)\b/i;
  const PACK_TO_BASE = { mg: 0.001, g: 1, kg: 1000, ml: 1, cl: 10, l: 1000, pcs: 1, pc: 1, pack: 1, unit: 1 };
  // A pack under one whole kg/L reads better in the sub-unit: 0.377kg → 377g,
  // 0.5L → 500ml. Only the display string changes; packBase (used for costing)
  // stays in the stored unit. Math.round strips the ×1000 float noise
  // (0.377 × 1000 = 377.0000…6).
  const fmtPackLabel = (value, unit) => {
    const v = Number(value);
    const u = String(unit || '');
    if (!Number.isFinite(v) || v <= 0) return `${value}${unit}`;
    const ul = u.toLowerCase();
    if (ul === 'kg' && v < 1) return `${Math.round(v * 1000 * 1000) / 1000}g`;
    if (ul === 'l' && v < 1) return `${Math.round(v * 1000 * 1000) / 1000}ml`;
    return `${v}${u}`; // ≥1 or already a sub-unit - keep the entered unit casing
  };
  const packInfo = (item) => {
    if (item.packSize && item.packSize > 0) {
      const { unit, mult } = effectiveDisplay(item);
      const packBase = item.packSize * mult;
      return { packBase, label: fmtPackLabel(item.packSize, unit), cost: (item.unitCost || 0) * packBase };
    }
    const mt = (item.itemName || '').match(PACK_RE);
    const baseFactor = PACK_TO_BASE[(item.unit || '').toLowerCase()] || 1;
    // A PIECE size in a name is only a pack when the name says so ("100pcs/
    // pack"). "12OZ ICED CUPS 50PCS" is cups counted one by one, and reading
    // its "50PCS" as a pack showed every figure divided by fifty.
    const pieceSize = mt && ['pcs', 'pc', 'pack', 'unit'].includes(mt[2].toLowerCase());
    const saysPack = /\d\s*(pcs|pc)\s*\/\s*(pack|box|bag|sleeve|case|pk)\b/i.test(item.itemName || '');
    if (mt && (!pieceSize || saysPack)) {
      const val = parseFloat(mt[1]);
      const f = PACK_TO_BASE[mt[2].toLowerCase()];
      if (f !== undefined && val > 0) {
        const packBase = val * (f / baseFactor);
        return { packBase, label: fmtPackLabel(mt[1], mt[2]), cost: (item.unitCost || 0) * packBase };
      }
    }
    const { unit, mult } = effectiveDisplay(item);
    return { packBase: mult, label: unit, cost: (item.unitCost || 0) * mult };
  };
  // Convenience: { qty, unit, cost } already converted to display.
  const itemDisplay = (item) => {
    const { unit, mult } = effectiveDisplay(item);
    const pack = packInfo(item);
    // What the item is COUNTED in - on the Hub, at the end-of-day count, for
    // waste, transfers and thresholds.
    //
    // Logistics counts packages: a carton, a sack, a can is the thing on the
    // shelf, and that is what "pcs" means there. A cafe counts in the real
    // measure - beans in kg, milk in L, cups one by one - the same units its
    // recipes and stock card use. Counting a cafe in packs showed a 1 kg bag
    // of beans with 940 g left as "0.94 packs", beside a recipe that said 20 g
    // and a stock card that said -20; the end-of-day count's own comment
    // always said "FB in kg/L", but this helper handed it the pack.
    //
    // packCost / packLabel still describe the pack, because that is what is
    // BOUGHT: prices stay "P1,200 / 1kg".
    const buysInPacks = pack.label !== unit;
    const inPacks = BUSINESS_TYPE === 'log';
    const countBase = inPacks ? pack.packBase : mult;
    return {
      qty:  (item.stockQty || 0) / mult,
      unit,
      cost: (item.unitCost || 0) * mult,
      packCost: pack.cost,                                  // cost of one named pack (e.g. ₱200 for 250g)
      packLabel: pack.label,                                // pack size label from the name (e.g. "250g")
      packBase: countBase,                                  // base units in one COUNTED unit
      packQty: countBase ? (item.stockQty || 0) / countBase : 0, // stock in counted units
      // Counted in packs: logistics only, and only when a real pack size is
      // known. Where it is false the unit reads kg / L / pcs.
      isPacked: inPacks && buysInPacks,
      // Bought in a named pack at all - for prices and the SET SIZE hint,
      // which is about buying, not counting.
      buysInPacks,
    };
  };
  // Analytics display: for logistics, show pack-count (pcs) instead of kg/L -
  // but ONLY when a real pack size is actually known (packSize field, or a
  // size embedded in the item name like "250G"/"1L"). Without one, packInfo()
  // silently falls back to effectiveDisplay's raw unit-conversion multiplier,
  // which is NOT a piece count - labelling that number "pcs" prints the raw
  // base-unit quantity (e.g. 59920 ml of milk) as if it were 59920 pieces.
  // So an unconfigured item shows its real unit (kg/L/ml/g) instead, same as
  // non-log businesses, until someone sets a pack size for it.
  const analyticsDisplay = (item) => {
    if (BUSINESS_TYPE === 'log') {
      const pack = packInfo(item);
      const { unit: rawUnit } = effectiveDisplay(item);
      const isRealPack = pack.label !== rawUnit;
      if (isRealPack) return { unit: 'pcs', mult: pack.packBase || 1 };
    }
    return effectiveDisplay(item);
  };
  // Pretty currency
  const peso = (n) => `₱${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

  return {
    itemDisplay, resolveUnitFE, packInfo, effectiveDisplay, analyticsDisplay, peso,
  };
}
