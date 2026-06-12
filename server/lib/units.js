// Display-unit → base-unit conversion table.
// Base units (g/ml/pcs) are what gets stored in stockQty and recipes.
// Display units (kg/L) are what humans read and buy in.

export const UNIT_TABLE = {
  // displayUnit : { baseUnit, multiplier }
  'g':   { base: 'g',   mult: 1 },
  'kg':  { base: 'g',   mult: 1000 },
  'ml':  { base: 'ml',  mult: 1 },
  'L':   { base: 'ml',  mult: 1000 },
  'pcs': { base: 'pcs', mult: 1 },
};

// Resolve a display unit into { baseUnit, multiplier }.
// Unknown strings fall back to (base = the string itself, mult = 1).
export function resolveUnit(displayUnit) {
  if (!displayUnit) return { base: 'pcs', mult: 1 };
  const u = String(displayUnit).trim();
  if (UNIT_TABLE[u]) return { base: UNIT_TABLE[u].base, mult: UNIT_TABLE[u].mult };
  // Case-insensitive fallback for L / kg variants
  const lowered = u.toLowerCase();
  if (lowered === 'l' || lowered === 'liter' || lowered === 'litre') return UNIT_TABLE.L;
  if (lowered === 'kg' || lowered === 'kilogram') return UNIT_TABLE.kg;
  if (lowered === 'g' || lowered === 'gram') return UNIT_TABLE.g;
  if (lowered === 'ml' || lowered === 'milliliter') return UNIT_TABLE.ml;
  if (lowered === 'pcs' || lowered === 'pc' || lowered === 'piece') return UNIT_TABLE.pcs;
  return { base: u, mult: 1 };
}

// Convert a display-unit quantity to its base-unit value.
// Example: displayToBase(1, 'L') => 1000 (ml)
export function displayToBase(qty, displayUnit) {
  const { mult } = resolveUnit(displayUnit);
  return Number(qty) * mult;
}

// Convert a base-unit cost to its display-unit cost.
// Example: baseToDisplayCost(0.07, 'L') => 70 (P/L when stored as P/ml)
export function baseToDisplayCost(unitCostPerBase, displayUnit) {
  const { mult } = resolveUnit(displayUnit);
  return Number(unitCostPerBase) * mult;
}

// Resolve the unit an operator should SEE for an inventory item, enforcing the
// app-wide rule that g/ml are never shown — they auto-promote to kg/L.
// Returns { displayUnit, mult } where mult = base units per 1 display unit, so
// a base-unit quantity divided by mult gives the display quantity.
//   { unit: 'g' }                 => { displayUnit: 'kg',  mult: 1000 }
//   { unit: 'ml' }                => { displayUnit: 'L',   mult: 1000 }
//   { unit: 'pcs' }               => { displayUnit: 'pcs', mult: 1 }
//   { displayUnit: 'kg' }         => { displayUnit: 'kg',  mult: 1000 }
export function effectiveDisplay(item = {}) {
  const du = String(item.displayUnit || '').trim();
  // Honor an explicit, already-promoted display unit (anything except g/ml).
  if (du && du !== 'g' && du !== 'ml') {
    const { mult } = resolveUnit(du);
    return { displayUnit: du, mult: mult > 0 ? mult : 1 };
  }
  // Otherwise auto-promote from the base unit so g/ml are never surfaced.
  const base = String(item.unit || du || 'pcs').toLowerCase();
  if (base === 'g')  return { displayUnit: 'kg', mult: 1000 };
  if (base === 'ml') return { displayUnit: 'L',  mult: 1000 };
  return { displayUnit: 'pcs', mult: 1 };
}
