// Parser for the INFU barista recipe workbooks.
//
// These sheets are written for humans standing at a bar, not for a machine:
// every ingredient is free text that mixes a quantity, a serving measure and a
// material name, and the Hot/Iced split is expressed with a slash. On top of
// that the COLUMN MEANINGS CHANGE per section (in "MATCHA SLOWBAR" the
// Procedure and Milk columns are swapped relative to every other section), so
// nothing here can rely on a fixed column index.
//
// Because of that this parser is deliberately conservative: it extracts what it
// is confident about, and flags everything else with `needsReview` rather than
// guessing silently. It is meant to feed a review screen where a human confirms
// the result before anything is written - never a blind import.
//
// Two sources, very different quality:
//   BULK RECIPE (cols 4-8 of the newer workbook) - a real table with
//     ingredient / size / unit / unit cost / used units. High confidence.
//   The drink sheets - free text. Best-effort, always needs review.

// Serving measures that describe HOW something is portioned rather than how
// much of it there is. When a cell carries both ("2 scoops 30g"), the mass or
// volume is the real quantity and the scoop count is descriptive.
const SERVING_MEASURES = ['scoop', 'scoops', 'pc', 'pcs', 'piece', 'pieces', 'dash', 'cm'];
const REAL_UNITS = ['ml', 'g', 'kg', 'l'];

const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

// Temperature words are handled narrowly on purpose. A bare "Hot" or "Iced" is
// a variant marker and never a material, and "Hot water" / "Cold Water" are all
// just water. But "Warm Milk" and "Steam Milk" are genuinely DIFFERENT
// materials from "Full Milk" - stripping the leading word there would merge
// three distinct prep states into one. So only these two cases are rewritten.
const TEMPERATURE_ONLY = /^(hot|iced|ice|cold|warm)$/i;
const TEMPERATURE_WATER = /^(hot|iced|ice|cold|warm)\s+water$/i;
// A serving measure with no number in front of it ("dash Nutmeg Powder", left
// behind once "1g" is consumed) describes the portion, not the material.
const LEADING_MEASURE = /^(scoops?|pcs?|pieces?|dash)\b\s*/i;
function stripTemperature(name) {
  let out = clean(name);
  let prev;
  do { prev = out; out = clean(out.replace(LEADING_MEASURE, '')); } while (out !== prev);
  if (TEMPERATURE_ONLY.test(out)) return '';
  if (TEMPERATURE_WATER.test(out)) return 'water';
  return out;
}

// "w/o espresso" and "w/ espresso" contain a slash that is NOT a separator.
// Protect them before the cell is split, and restore afterwards.
const WITH_TOKEN = 'WITH';
const WITHOUT_TOKEN = 'WITHOUT';
const protectSlashes = (t) => t.replace(/\bw\/o\b/gi, WITHOUT_TOKEN).replace(/\bw\/(?=\s)/gi, WITH_TOKEN);
const restoreSlashes = (t) => t.split(WITHOUT_TOKEN).join('w/o').split(WITH_TOKEN).join('w/');

// Cells that are measurements of the DRINK rather than an ingredient: bare
// numbers (cup fill levels), "0.5 cm" foam depths, "220g Fill cup" ice.
export function isNoiseCell(text) {
  const t = clean(text);
  if (!t) return true;
  if (/^[\d\s./]+$/.test(t)) return true;                 // "130", "100 /120"
  if (/^\d+(\.\d+)?\s*cm$/i.test(t)) return true;         // "0.5 cm"
  if (/\b(fill|line)\s+cup\b/i.test(t)) return true;      // "220g Fill cup"
  return false;
}

// Pull a leading quantity off one segment. Prefers a real unit (g/ml) over a
// serving measure, so "2 scoops 30g Cocoa" yields 30 g and not 2 scoops.
function takeQuantity(segment) {
  const t = clean(segment);
  if (!t) return { qty: null, unit: null, rest: '' };

  const unitAlt = [...REAL_UNITS, ...SERVING_MEASURES].join('|');
  // A barista range ("30-35ml") is ONE quantity, not two. Collapse it to its
  // midpoint first - that is what average consumption looks like, and it stops
  // the low number being stranded in the material name ("Hot 30").
  const ranged = t.replace(
    new RegExp(`(\\d+(?:\\.\\d+)?)\\s*-\\s*(\\d+(?:\\.\\d+)?)\\s*(${unitAlt})\\b`, 'gi'),
    (_m, a, b, u) => `${Math.round(((parseFloat(a) + parseFloat(b)) / 2) * 100) / 100}${u}`,
  );
  const re = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${unitAlt})\\b`, 'gi');
  const matches = [...ranged.matchAll(re)];
  if (matches.length === 0) return { qty: null, unit: null, rest: stripTemperature(ranged) };

  // Prefer the first match carrying a real unit; fall back to the first match.
  const preferred = matches.find(m => REAL_UNITS.includes(m[2].toLowerCase())) || matches[0];
  let rest = ranged;
  // Strip every quantity token, plus any bare leading count ("1 Scoop" already
  // covered, but "2 scoops 30g" leaves nothing stray).
  for (const m of matches) rest = rest.replace(m[0], ' ');
  rest = clean(rest.replace(/^[\s/.,-]+|[\s/.,-]+$/g, ''));

  return {
    qty: parseFloat(preferred[1]),
    unit: preferred[2].toLowerCase(),
    rest: stripTemperature(rest),
  };
}

/**
 * Parse one free-text ingredient cell.
 *
 * Returns { components, variants, needsReview, raw }.
 *  - `components` are separate materials used together in the same drink.
 *  - `variants` express the Hot/Iced split of the SAME position.
 * Only one of the two is ever populated.
 */
export function parseIngredientCell(text) {
  const raw = clean(text);
  const out = { components: [], variants: [], needsReview: false, raw };
  if (!raw || isNoiseCell(raw)) return out;

  const segments = protectSlashes(raw).split('/').map(t => clean(restoreSlashes(t))).filter(Boolean);
  const parsed = segments.map(takeQuantity);

  // Single segment: the simple, confident case.
  if (parsed.length === 1) {
    const p = parsed[0];
    if (p.qty == null) {
      // A name with no quantity cannot be costed - someone has to supply it.
      out.needsReview = true;
      if (p.rest) out.components.push({ qty: null, unit: null, name: p.rest });
      return out;
    }
    // A quantity with no name is normal and unambiguous: the material is the
    // COLUMN ("Espresso", "Hot Water"), and parseDrinkSheet fills it in.
    out.components.push({ qty: p.qty, unit: p.unit, name: p.rest });
    return out;
  }

  const withQty = parsed.filter(p => p.qty != null);
  const named = parsed.filter(p => p.rest);
  const everySegmentComplete = parsed.every(p => p.qty != null && p.rest);

  // Every segment carries its own quantity AND name - these are distinct
  // materials combined in one drink, e.g. a foam built from three things.
  if (everySegmentComplete) {
    out.components = parsed.map(p => ({ qty: p.qty, unit: p.unit, name: p.rest }));
    // Two complete segments in the same unit are genuinely ambiguous: they may
    // be two materials, or the Hot/Iced split of two different milks. A human
    // has to decide.
    out.needsReview = true;
    return out;
  }

  // Otherwise the leading segments are bare quantities and the names trail
  // behind - the Hot / Iced shape: "260ml / 150ml Full Milk".
  const names = named.map(p => p.rest);
  if (withQty.length >= 2 && names.length >= 1) {
    const labels = ['hot', 'iced'];
    out.variants = withQty.slice(0, 2).map((p, i) => ({
      variant: labels[i] || `v${i + 1}`,
      qty: p.qty,
      unit: p.unit,
      // One trailing name means both variants use the same material; two means
      // the material itself differs between hot and iced.
      name: names.length === 1 ? names[0] : (names[i] || names[names.length - 1]),
    }));
    out.needsReview = withQty.length > 2 || names.length > 2;
    return out;
  }

  out.needsReview = true;
  out.components = parsed.filter(p => p.rest).map(p => ({ qty: p.qty, unit: p.unit, name: p.rest }));
  return out;
}

/**
 * Parse the structured bulk-recipe table that sits in columns 4-8 of the newer
 * workbook's BULK RECIPE sheet. This one IS a real table, so it parses cleanly.
 *
 * Layout, repeated per bulk item:
 *   "<Name> (<yield>)"
 *   INGREDIENTS | SIZE | UNIT | UNIT COST | USED UNITS
 *   <rows...>
 *   Total Cost
 */
export function parseBulkRecipes(rows) {
  const recipes = [];
  let current = null;

  for (const row of rows) {
    const [name, size, unit, unitCost, usedUnits] = (row || []).slice(4, 9).map(clean);
    if (!name) continue;

    if (/^total cost/i.test(name)) { current = null; continue; }
    if (/^ingredients$/i.test(name)) continue;

    // A title row carries only a name, e.g. "Spanish Milk Bulk (2077ml)".
    if (!size && !unit) {
      const m = name.match(/^(.*?)\s*\(([\d.]+)\s*(ml|g|l|kg)\)\s*$/i);
      current = {
        name: m ? clean(m[1]) : name,
        yieldQty: m ? parseFloat(m[2]) : null,
        yieldUnit: m ? m[3].toLowerCase() : null,
        ingredients: [],
      };
      recipes.push(current);
      continue;
    }

    if (!current) continue;
    const packSize = parseFloat(size);
    const packCost = parseFloat(unitCost);
    const used = parseFloat(usedUnits);
    current.ingredients.push({
      name,
      unit: unit.toLowerCase(),
      // SIZE + UNIT COST describe the purchase pack (250 g costs 151), while
      // USED UNITS is what this recipe consumes. Cost per base unit falls out
      // of the pack, and is what an inventory item actually needs.
      packSize: Number.isFinite(packSize) ? packSize : null,
      packCost: Number.isFinite(packCost) ? packCost : null,
      costPerUnit: Number.isFinite(packSize) && Number.isFinite(packCost) && packSize > 0
        ? Math.round((packCost / packSize) * 10000) / 10000
        : null,
      qty: Number.isFinite(used) ? used : null,
    });
  }

  return recipes.filter(r => r.ingredients.length > 0);
}

/**
 * Walk a drink sheet and pull out every drink with its parsed ingredient cells.
 *
 * Section headers are identified by the literal "CUP MARK" in column 1, and the
 * header row itself names that section's columns - which is the only reliable
 * way to read them, since their order changes between sections.
 */
export function parseDrinkSheet(rows) {
  const drinks = [];
  let headers = null;
  let section = '';

  // Columns that describe presentation rather than an ingredient.
  const NON_INGREDIENT = /^(cup mark|size|cups|procedure|ice)\s*$/i;

  for (const row of rows || []) {
    const cells = (row || []).map(clean);
    const name = cells[0];

    if (clean(cells[1]).toLowerCase() === 'cup mark') {
      section = name;
      headers = cells;
      continue;
    }
    if (!headers || !name) continue;
    // A title banner row ("INFU COFFEE") has nothing else on it.
    if (cells.slice(1).every(c => !c)) continue;

    const ingredients = [];
    for (let c = 2; c < headers.length; c++) {
      const columnName = headers[c];
      if (!columnName || NON_INGREDIENT.test(columnName)) continue;
      const parsed = parseIngredientCell(cells[c]);
      if (parsed.components.length === 0 && parsed.variants.length === 0) continue;
      // "Hot 30-35ml" in the Espresso column means 32.5ml OF ESPRESSO - the
      // cell carries the amount and the column carries the material.
      const named = (x) => (x.name ? x : { ...x, name: columnName });
      ingredients.push({
        column: columnName,
        ...parsed,
        components: parsed.components.map(named),
        variants: parsed.variants.map(named),
      });
    }

    drinks.push({
      name,
      cupMark: cells[1] || '',
      section,
      sizes: cells[2] || '',
      ingredients,
      needsReview: ingredients.some(i => i.needsReview),
    });
  }

  return drinks;
}

// Every distinct material named across parsed drinks and bulk recipes, so the
// import can be matched against Inventory in one pass instead of per drink.
export function collectMaterials({ drinks = [], bulkRecipes = [] } = {}) {
  const byKey = new Map();
  const add = (name, unit) => {
    const n = clean(name);
    if (!n) return;
    const key = n.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, { name: n, units: new Set(), uses: 0 });
    const e = byKey.get(key);
    if (unit) e.units.add(unit);
    e.uses += 1;
  };

  for (const d of drinks) {
    for (const ing of d.ingredients) {
      for (const c of ing.components) add(c.name, c.unit);
      for (const v of ing.variants) add(v.name, v.unit);
    }
  }
  for (const r of bulkRecipes) for (const i of r.ingredients) add(i.name, i.unit);

  return [...byKey.values()]
    .map(e => ({ name: e.name, units: [...e.units], uses: e.uses }))
    .sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name));
}
