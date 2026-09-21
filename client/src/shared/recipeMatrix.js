// The recipe matrix: ingredients down the side, one column per size.
//
// The product keeps storing what it always has - `baseRecipe` for the base
// size and `recipe` on each extra size - so the server, the till's deduction
// and every report are untouched. These functions only translate between that
// shape and a grid: a row per ingredient, a cell per size.
//
// A cell holds the amount as a person reads it. For a café that is the stock
// unit itself (18 g, 180 ml, 1 pc), so `packBase` is 1. Logistics recipes are
// counted in packs, stored as packs × pack size, so the cell shows
// qty / packBase and a typed amount is stored as amount × packBase.

export const rowKeyOf = (line) => (line && line.invId
  ? `inv:${String(line.invId)}`
  : `ns:${String((line && line.name) || '').trim().toLowerCase()}`);

// Column 0 is the base size; column n is extra size n-1.
export const columnsOf = (form = {}) => [
  { name: form.baseSize || '', price: form.basePrice, recipe: form.baseRecipe || [] },
  ...(form.sizes || []).map((s) => ({ name: s.name || '', price: s.price, recipe: s.recipe || [] })),
];

const pb = (x) => Number(x) || 1;

// Every ingredient used by any size, once, in the order first seen - plus any
// row the person has added but not yet given an amount.
export function matrixRows(form, pending = []) {
  const rows = new Map();
  columnsOf(form).forEach((col, ci) => {
    for (const line of col.recipe) {
      const key = rowKeyOf(line);
      if (!rows.has(key)) {
        rows.set(key, {
          key, invId: line.invId ? String(line.invId) : null, name: line.name || '', unit: line.unit || '',
          packBase: pb(line.packBase), nonStock: !!line.nonStock, cost: Number(line.cost) || 0, cells: [],
        });
      }
      rows.get(key).cells[ci] = +((Number(line.qty) || 0) / pb(line.packBase)).toFixed(6);
    }
  });
  for (const r of pending) if (!rows.has(r.key)) rows.set(r.key, { ...r, cells: [] });
  return [...rows.values()];
}

// Set one cell. An amount above zero puts the ingredient in that size's recipe
// (or changes it); zero or blank takes it out, so a size never carries a line
// that deducts nothing.
export function setCell(form, row, col, value) {
  const amount = Number(value);
  const on = value !== '' && Number.isFinite(amount) && amount > 0;
  const qty = on ? +(amount * pb(row.packBase)).toFixed(6) : 0;
  const line = {
    ...(row.invId ? { invId: row.invId } : {}),
    name: row.name, qty, cost: Number(row.cost) || 0, unit: row.unit, packBase: pb(row.packBase),
    ...(row.nonStock ? { nonStock: true } : {}),
  };
  const apply = (recipe = []) => {
    const i = recipe.findIndex((l) => rowKeyOf(l) === row.key);
    if (!on) return i < 0 ? recipe : recipe.filter((_, j) => j !== i);
    if (i < 0) return [...recipe, line];
    const next = recipe.slice();
    next[i] = { ...next[i], qty };
    return next;
  };
  if (col === 0) return { ...form, baseRecipe: apply(form.baseRecipe) };
  return { ...form, sizes: (form.sizes || []).map((s, j) => (j === col - 1 ? { ...s, recipe: apply(s.recipe) } : s)) };
}

// Take an ingredient out of every size.
export function removeRow(form, key) {
  const drop = (recipe = []) => recipe.filter((l) => rowKeyOf(l) !== key);
  return { ...form, baseRecipe: drop(form.baseRecipe), sizes: (form.sizes || []).map((s) => ({ ...s, recipe: drop(s.recipe) })) };
}

// A new size starts as a copy of the base recipe: an iced 12oz is usually the
// hot 8oz plus a cup and more milk, so there is less to type than starting
// from nothing - and nothing is silently missing from it.
export function addSizeColumn(form, { copyBase = true } = {}) {
  const recipe = copyBase ? (form.baseRecipe || []).map((l) => ({ ...l })) : [];
  return { ...form, sizes: [...(form.sizes || []), { name: '', price: 0, recipe }] };
}

export function removeSizeColumn(form, col) {
  if (col < 1) return form;
  return { ...form, sizes: (form.sizes || []).filter((_, j) => j !== col - 1) };
}

// Margin on a price, as a fraction; null when there is no price to judge.
export function marginOf(price, cost) {
  const p = Number(price) || 0;
  if (p <= 0) return null;
  return (p - (Number(cost) || 0)) / p;
}

// What still needs doing before the product is right - shown, never blocking.
export function readiness(form, costOf) {
  const cols = columnsOf(form);
  const issues = [];
  cols.forEach((c, i) => {
    const label = i === 0 ? (c.name || 'the base size') : (c.name || `size ${i + 1}`);
    if (i > 0 && !c.name.trim()) issues.push(`Size ${i + 1} has no name.`);
    if (!(Number(c.price) > 0)) issues.push(`${label} has no price.`);
    if (!c.recipe.length) issues.push(`${label} has no recipe, so a sale takes nothing from stock.`);
    const m = marginOf(c.price, costOf ? costOf(c.recipe) : 0);
    if (m !== null && m < 0) issues.push(`${label} sells for less than it costs to make.`);
  });
  return issues;
}
