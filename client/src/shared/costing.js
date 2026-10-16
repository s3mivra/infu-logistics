// The Costing tab's arithmetic: what one unit of something costs to make or
// buy, and the selling price that cost calls for. Pure functions, no React, so
// every figure the screen shows is tested here.
//
// A costing sheet is a list of lines, of three kinds:
//   stock     a stock item at its current cost per base unit (g / ml / pcs),
//             in any of that item's units: base, kg/L, or one pack.
//   amount    a fixed peso amount per unit: labour, freight, a sticker.
//   percent   a share of everything above it: overhead, wastage, spoilage.
//
// The price is then either a markup on cost (cost x (1 + markup)) or a target
// margin (cost / (1 - margin)); VAT, when the business charges it, goes on top
// of that; and the result is rounded UP to a step (5 -> P125), so rounding can
// only ever add margin, never quietly take it away.

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const r4 = (n) => Math.round((Number(n) || 0) * 1e4) / 1e4;

// The units a stock line can be written in, and how many base units each is.
export function unitChoices(item = {}) {
  const base = String(item.unit || 'pcs').toLowerCase();
  const out = [{ label: base, factor: 1 }];
  if (base === 'g') out.push({ label: 'kg', factor: 1000 });
  if (base === 'ml') out.push({ label: 'L', factor: 1000 });
  const mult = num(item.unitMultiplier) > 0 ? num(item.unitMultiplier) : 1;
  const pack = num(item.packSize) > 0 ? num(item.packSize) * mult : 0;
  if (pack > 0 && !out.some(u => u.factor === pack)) out.push({ label: 'pack', factor: pack });   // a 1 kg pack is just a kg
  return out;
}

export function lineCost(line, invById) {
  if (!line) return 0;
  if (line.kind === 'amount') return num(line.amount);
  if (line.kind === 'stock') {
    const item = invById.get(String(line.invId));
    if (!item) return 0;
    const unit = unitChoices(item).find(u => u.label === line.unit) || unitChoices(item)[0];
    return num(line.qty) * unit.factor * num(item.unitCost);
  }
  return 0;   // percent lines are worked out on the subtotal, see sheetTotals
}

// Lines in order: a percent line applies to the running subtotal of every line
// above it (so "wastage 5%" then "overhead 10%" compounds as written).
export function sheetTotals(lines = [], invById = new Map()) {
  let running = 0;
  const each = [];
  for (const line of lines) {
    const cost = line.kind === 'percent' ? running * (num(line.percent) / 100) : lineCost(line, invById);
    running += cost;
    each.push(r4(cost));
  }
  return { lines: each, cost: r4(running) };
}

// Round UP to the nearest step (0 or blank = to the centavo).
export function roundUpTo(value, step) {
  const s = num(step);
  if (!(s > 0)) return r2(value);
  return r2(Math.ceil(r4(value / s)) * s);
}

export function priceFrom({ cost, method = 'markup', rate = 0, vatRate = 0, rounding = 0 }) {
  const c = num(cost);
  const r = num(rate) / 100;
  let net;
  if (method === 'margin') {
    if (r >= 1) return { error: 'A margin must be under 100%.' };
    net = c / (1 - r);
  } else {
    net = c * (1 + r);
  }
  const vat = num(vatRate) / 100;
  const srp = roundUpTo(net * (1 + vat), rounding);
  // What the business keeps of that price, after VAT is taken back out.
  const exVat = srp / (1 + vat);
  const profit = exVat - c;
  return {
    net: r2(net), srp, exVat: r2(exVat), profit: r2(profit),
    margin: exVat > 0 ? r2((profit / exVat) * 100) : 0,
    markup: c > 0 ? r2((profit / c) * 100) : null,
  };
}

// The margin an existing price gives on this cost, to compare against.
export function marginAt(price, cost, vatRate = 0) {
  const exVat = num(price) / (1 + num(vatRate) / 100);
  if (!(exVat > 0)) return null;
  return r2(((exVat - num(cost)) / exVat) * 100);
}

// The plainest unit for a quantity in base units: the biggest one it divides
// into a whole number of (2,000 ml of a 2 L bottle = 1 pack; 1,500 g = 1.5 kg).
export function bestUnit(item, baseQty) {
  const q = num(baseQty);
  const choices = unitChoices(item).slice().sort((a, b) => b.factor - a.factor);
  const whole = choices.find(u => u.factor > 1 && q >= u.factor && Math.abs(q / u.factor - Math.round(q / u.factor)) < 1e-9);
  const tidy = whole || choices.find(u => u.factor > 1 && q >= u.factor && Math.abs((q / u.factor) * 100 - Math.round((q / u.factor) * 100)) < 1e-6);
  const u = tidy || choices[choices.length - 1];
  return { unit: u.label, qty: Math.round((q / u.factor) * 1e6) / 1e6 };
}

// A sheet's lines filled from a product: its recipe (a cafe drink, or the size
// asked for), or - for a logistics product with no recipe - the stock item it
// sells, one sold unit of it. Non-stock recipe lines (filtered water) cost
// nothing and are left out; a line whose stock item is gone is kept by name so
// the gap is visible.
export function linesFromProduct(product, { sizeIndex = -1, inventory = [] } = {}) {
  if (!product) return [];
  const byId = new Map(inventory.map(i => [String(i._id), i]));
  const byName = new Map(inventory.map(i => [String(i.itemName || '').trim().toUpperCase(), i]));
  const size = sizeIndex >= 0 ? (product.sizes || [])[sizeIndex] : null;
  const recipe = (size?.recipe?.length ? size.recipe : product.baseRecipe) || [];
  const stockLines = recipe.filter(l => !l?.nonStock);
  if (stockLines.length) {
    return stockLines.map(l => {
      const item = (l.invId && byId.get(String(l.invId))) || byName.get(String(l.name || '').trim().toUpperCase());
      return item
        ? { kind: 'stock', invId: String(item._id), name: item.itemName, ...bestUnit(item, l.qty) }
        : { kind: 'amount', name: `${l.name || 'Missing item'} (not in stock any more)`, amount: num(l.cost) * num(l.qty) };
    });
  }
  const linked = (product.productCode && inventory.find(i => i.itemCode && i.itemCode === product.productCode))
    || byName.get(String(product.name || '').trim().toUpperCase());
  if (linked) {
    const choices = unitChoices(linked);
    const pack = choices.find(u => u.label === 'pack');
    return [{ kind: 'stock', invId: String(linked._id), name: linked.itemName, qty: 1, unit: pack ? 'pack' : choices[0].label }];
  }
  return [];
}

// The price a sheet's result would replace: the size's own price, else the base.
export function currentPrice(product, sizeIndex = -1) {
  if (!product) return null;
  const size = sizeIndex >= 0 ? (product.sizes || [])[sizeIndex] : null;
  const p = size && num(size.price) > 0 ? size.price : product.basePrice;
  return num(p) > 0 ? num(p) : null;
}
