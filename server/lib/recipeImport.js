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
const LEADING_MEASURE = /^(scoops?|pcs?|pieces?|dash|drizzle)\b\s*/i;
function stripTemperature(name) {
  let out = clean(name);
  let prev;
  do { prev = out; out = clean(out.replace(LEADING_MEASURE, '')); } while (out !== prev);
  if (TEMPERATURE_ONLY.test(out)) return '';
  if (TEMPERATURE_WATER.test(out)) return 'water';
  // The sheets write plain water three ways. One material, one stock item.
  if (/^(h20|h2o|water)$/i.test(out)) return 'water';
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

// The sheets separate a quantity from its material with a WIDE run of spaces,
// and a multi-part cell ends with the name of the thing being built:
//
//   "20ml everwhip          Rocksalted Cheese Foam"
//
// "everwhip" is the material; "Rocksalted Cheese Foam" is the label for the
// whole cell. Read naively the last material became "everwhip Rocksalted
// Cheese Foam" - a material that does not exist in stock, so the line was
// dropped and the foam silently lost three of its ingredients.
//
// Only strip when the text BEFORE the gap already carries a quantity AND a
// name of its own. "150ml        Breve Milk" has only a quantity in front, so
// there the trailing text IS the material and must be kept.
const WIDE_GAP = /\s{3,}/;
function stripTrailingLabel(rawSegment) {
  const parts = String(rawSegment == null ? '' : rawSegment).split(WIDE_GAP).filter(x => clean(x));
  if (parts.length < 2) return { text: rawSegment, label: '' };
  const head = clean(parts[0]);
  const q = takeQuantity(head);
  if (q.qty == null || !q.rest) return { text: rawSegment, label: '' };
  return { text: head, label: clean(parts.slice(1).join(' ')) };
}

/**
 * Parse one free-text ingredient cell.
 *
 * Returns { components, variants, needsReview, raw, label }.
 *  - `components` are separate materials used together in the same drink.
 *  - `variants` express the Hot/Iced split of the SAME position.
 * Only one of the two is ever populated.
 *
 * `sizeCount` is how many sizes the drink has. A Hot/Iced split is only
 * possible when there are two of them; on a single-size drink "30ml A / 30ml B"
 * can only mean two materials used together.
 */
// "w/o espresso 240ml Biscoff Based" and "w/ espresso 220ml Biscoff Based"
// are the SAME material in two builds of the drink, not two materials. The
// qualifier is taken off the name and the drink is flagged, because which
// build the menu sells is a decision only the operator can make.
const BUILD_QUALIFIER = /\bw\/o?\s+\S+/i;

export function parseIngredientCell(text, { sizeCount = 2 } = {}) {
  const rawText = String(text == null ? '' : text);
  const raw = clean(rawText);
  const out = { components: [], variants: [], needsReview: false, raw, label: '' };
  if (!raw || isNoiseCell(raw)) return out;

  // Split on the RAW text so the wide gaps survive; each segment is cleaned
  // after its trailing label has been taken off.
  let rawSegments = protectSlashes(rawText).split('/').map(restoreSlashes).filter(t => clean(t));
  if (rawSegments.length >= 2) {
    const last = stripTrailingLabel(rawSegments[rawSegments.length - 1]);
    if (last.label) {
      rawSegments[rawSegments.length - 1] = last.text;
      out.label = last.label;
    }
  }
  const segments = rawSegments.map(clean).filter(Boolean);
  const parsed = segments.map(takeQuantity);

  // Single segment: the simple, confident case.
  if (parsed.length === 1) {
    const p = parsed[0];
    if (BUILD_QUALIFIER.test(p.rest)) {
      p.rest = clean(p.rest.replace(BUILD_QUALIFIER, ''));
      out.needsReview = true;
    }
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
    // Three or more cannot be a Hot/Iced split - there are only two
    // temperatures - so a foam built from three things is not ambiguous at
    // all. Flagging it skipped whole drinks that parse perfectly well.
    //
    // A PAIR is ambiguous only when the drink actually has two sizes to split
    // between; on a single-size drink the two materials are simply both used.
    out.needsReview = parsed.length === 2 && sizeCount >= 2;
    return out;
  }

  // Otherwise the leading segments are bare quantities and the names trail
  // behind - the Hot / Iced shape: "260ml / 150ml Full Milk".
  const names = named.map(p => p.rest);
  if (withQty.length >= 2 && names.length >= 1) {
    // With only one size there is nothing to split between, so "40ml / 40ml
    // Warm water / Oat Milk" lists two things the drink uses together. Read as
    // a temperature split the second was thrown away entirely - every matcha
    // lost its oat milk, and the seasalt einspanner its spanish milk.
    if (sizeCount < 2) {
      out.components = withQty.map((p, i) => ({
        qty: p.qty, unit: p.unit,
        name: names.length === 1 ? names[0] : (names[i] || names[names.length - 1]),
      })).filter(c => c.name);
      out.needsReview = withQty.length > names.length && names.length > 1;
      return out;
    }
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

  // Columns that describe presentation or price rather than an ingredient.
  // SRP belongs here: read as an ingredient it produced a "180" material.
  const NON_INGREDIENT = /^(cup mark|size|cups|procedure|ice|srp|price|add oz)\s*$/i;
  const findCol = (re, fallback) => {
    const i = (headers || []).findIndex(h => re.test(String(h || '').trim()));
    return i >= 0 ? i : fallback;
  };

  for (const row of rows || []) {
    // Both forms are needed: the cleaned cells to read structure, and the raw
    // ones for the ingredient parser, which uses the sheet's wide space runs
    // to tell a material from the label of the thing being built.
    const rawCells = (row || []).map(c => String(c == null ? '' : c));
    const cells = rawCells.map(clean);
    const name = cells[0];

    if (clean(cells[1]).toLowerCase() === 'cup mark') {
      section = name;
      headers = cells;
      continue;
    }
    if (!headers || !name) continue;
    // A title banner row ("INFU COFFEE") has nothing else on it.
    if (cells.slice(1).every(c => !c)) continue;

    // Column positions come from the header row, not fixed indexes: the
    // sections do not agree on column order, and SRP sits at the far right.
    const sizeCol = findCol(/^size$/i, 2);
    const srpCol = findCol(/^(srp|price)$/i, -1);
    const sizeCell = cells[sizeCol] || '';
    const sizeCount = Math.max(1, [...String(sizeCell).matchAll(VOLUME_RE)].length);

    const ingredients = [];
    for (let c = 2; c < headers.length; c++) {
      const columnName = headers[c];
      if (!columnName || NON_INGREDIENT.test(columnName)) continue;
      const parsed = parseIngredientCell(rawCells[c], { sizeCount });
      if (parsed.components.length === 0 && parsed.variants.length === 0) continue;
      // Some sections express the Hot/Iced split as two SEPARATE columns of the
      // same name ("Espresso" twice, one cell reading "Hot 30-35ml" and the
      // other "Iced 30-35ml") rather than as one slashed cell. The temperature
      // is stripped from the material name - correctly, it is not part of it -
      // so without this hint the two cells look like one ingredient listed
      // twice, and the recipe would double the espresso.
      const tempHint = /^\s*hot\b/i.test(cells[c]) ? 'hot'
        : /^\s*iced?\b/i.test(cells[c]) ? 'iced' : '';
      // "Hot 30-35ml" in the Espresso column means 32.5ml OF ESPRESSO - the
      // cell carries the amount and the column carries the material.
      const named = (x) => (x.name ? x : { ...x, name: columnName });
      ingredients.push({
        column: columnName,
        tempHint,
        // What the cell as a whole builds ("Rocksalted Cheese Foam"), when it
        // named itself. Kept for the review screen, never as a material.
        label: parsed.label || '',
        ...parsed,
        components: parsed.components.map(named),
        variants: parsed.variants.map(named),
      });
    }

    drinks.push({
      name,
      cupMark: cells[1] || '',
      section,
      sizes: sizeCell,
      // "130/150" is one price per size, "180" one price for the drink.
      prices: parsePrices(srpCol >= 0 ? cells[srpCol] : ''),
      ingredients,
      needsReview: ingredients.some(i => i.needsReview),
    });
  }

  return drinks;
}

// ── SIZES ────────────────────────────────────────────────────────────────────
// The Size cell packs volumes and temperatures into one string, each
// slash-separated and paired positionally:
//
//   "12oz / 16oz Hot / Iced"  ->  12oz Hot, 16oz Iced
//   "16oz Iced"               ->  16oz Iced
//   "16oz"                    ->  16oz
//
// Reading it as one size loses the fact that a hot 12oz and an iced 16oz are
// different drinks with different recipes - which is exactly what the paired
// "260ml / 150ml" ingredient cells are describing. Volume order matches
// variant order (hot first), so size[0] takes the hot quantity and size[1] the
// iced one.
const VOLUME_RE = /(\d+(?:\.\d+)?)\s*(oz|ml|l)\b/gi;
const TEMP_RE = /\b(hot|iced|cold|warm)\b/gi;

// The SRP cell carries one price per size, in the same order as the sizes:
// "130/150" is 130 for the 8oz hot and 150 for the 12oz iced; "180" is one
// price for the whole drink. Ignoring it made every imported drink cost 0.
export function parsePrices(srpCell) {
  const raw = clean(srpCell);
  if (!raw) return [];
  return raw.split('/')
    .map(t => parseFloat(clean(t).replace(/[^\d.]/g, '')))
    .filter(n => Number.isFinite(n) && n >= 0);
}

export function parseSizes(sizeCell) {
  const raw = clean(sizeCell);
  if (!raw) return [];
  const volumes = [...raw.matchAll(VOLUME_RE)].map(m => `${m[1]}${m[2].toLowerCase()}`);
  const temps = [...raw.matchAll(TEMP_RE)].map(m => m[1][0].toUpperCase() + m[1].slice(1).toLowerCase());
  if (volumes.length === 0) return [];

  return volumes.map((volume, i) => {
    // One temperature against several volumes applies to all of them; more
    // volumes than temperatures leaves the extras untemped rather than
    // borrowing a label that was not written.
    const temp = temps.length === 1 && volumes.length > 1 ? temps[0] : temps[i];
    return {
      name: temp ? `${volume} ${temp}` : volume,
      volume, temp: temp || '',
      // Which slash-separated ingredient quantity belongs to this size.
      variantIndex: i,
    };
  });
}

/**
 * Turn one parsed drink into the product shape the importer expects.
 *
 * A drink with two sizes becomes two entries under Extra Sizes, each carrying
 * only the quantities for its own temperature. Putting both into one recipe
 * would silently double every ingredient.
 */
export function buildProductDraft(drink) {
  const sizes = parseSizes(drink?.sizes);
  const prices = Array.isArray(drink?.prices) ? drink.prices : [];
  // One price against several sizes applies to all of them.
  const priceFor = (i) => (prices.length === 1 ? prices[0] : (prices[i] ?? 0)) || 0;

  // Ingredients that do not vary by temperature apply to every size.
  const shared = [];
  const perVariant = new Map();
  const addVariant = (idx, row) => {
    if (!perVariant.has(idx)) perVariant.set(idx, []);
    perVariant.get(idx).push(row);
  };
  for (const ing of (drink?.ingredients || [])) {
    for (const c of ing.components) {
      if (!(c.qty > 0) || !c.name) continue;
      const row = { name: c.name, qty: c.qty, unit: c.unit };
      // A cell that named its own temperature belongs to that size only. Left
      // in `shared` it would be added to BOTH sizes, so a drink with separate
      // Hot and Iced espresso columns would get two shots in every cup.
      if (ing.tempHint === 'hot') addVariant(0, row);
      else if (ing.tempHint === 'iced') addVariant(1, row);
      else shared.push(row);
    }
    for (const v of ing.variants) {
      if (!(v.qty > 0) || !v.name) continue;
      // A cell that already declared its temperature ("HOT 130ml / 130ml
      // Breve Milk / Spanish Milk") is not splitting hot from iced - it is
      // listing two materials the HOT drink uses together. Reading the pair as
      // a temperature split gave the hot cup the Breve and the iced cup the
      // Spanish, when each cup takes both.
      if (ing.tempHint === 'hot' || ing.tempHint === 'iced') {
        addVariant(ing.tempHint === 'iced' ? 1 : 0, { name: v.name, qty: v.qty, unit: v.unit });
        continue;
      }
      addVariant(v.variant === 'iced' ? 1 : 0, { name: v.name, qty: v.qty, unit: v.unit });
    }
  }

  // One material named by two columns - truffle oil in the syrup AND in the
  // foam, spanish milk in the base AND in the foam - is one recipe line for
  // the total. Two lines for the same stock item read as a mistake on the
  // product editor and made the sheet look mis-parsed.
  const mergeLines = (rows) => {
    const byKey = new Map();
    for (const r of rows) {
      const key = `${String(r.name).toLowerCase().trim()}|${String(r.unit || '').toLowerCase()}`;
      const hit = byKey.get(key);
      if (hit) hit.qty = Math.round((hit.qty + r.qty) * 1000) / 1000;
      else byKey.set(key, { ...r });
    }
    return [...byKey.values()];
  };

  const recipeFor = (variantIndex) => mergeLines([
    ...shared,
    ...(perVariant.get(variantIndex) || []),
  ]);

  // No size cell at all: one recipe, everything folded together.
  if (sizes.length === 0) {
    return {
      name: drink?.name || '', category: drink?.section || 'Uncategorized',
      baseSizeName: '', sizes: [], srp: priceFor(0),
      baseRecipe: mergeLines([...shared, ...(perVariant.get(0) || [])]),
      needsReview: !!drink?.needsReview,
    };
  }

  // One size: it is the base size, named so an operator sees "16oz Iced"
  // rather than a blank field.
  if (sizes.length === 1) {
    return {
      name: drink?.name || '', category: drink?.section || 'Uncategorized',
      baseSizeName: sizes[0].name, sizes: [], srp: priceFor(0),
      baseRecipe: recipeFor(0),
      needsReview: !!drink?.needsReview,
    };
  }

  // Several: each becomes its own extra size with its own recipe.
  return {
    name: drink?.name || '', category: drink?.section || 'Uncategorized',
    baseSizeName: sizes[0].name, srp: priceFor(0),
    baseRecipe: recipeFor(0),
    sizes: sizes.slice(1).map((sz, i) => ({
      name: sz.name, sizeCode: sz.volume, price: priceFor(i + 1),
      recipe: recipeFor(sz.variantIndex),
    })),
    needsReview: !!drink?.needsReview,
  };
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
