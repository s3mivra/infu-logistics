// Parser for the INFU barista recipe workbooks. The cases below are taken
// verbatim from the real sheets - every string here is a cell that actually
// appears, which is why some of them look the way they do.
import { describe, it, expect } from 'vitest';
import {
  isNoiseCell,
  parseIngredientCell,
  parseBulkRecipes,
  parseDrinkSheet,
  collectMaterials,
  parseSizes,
  buildProductDraft,
} from './recipeImport.js';

const one = (text) => parseIngredientCell(text).components[0];

describe('isNoiseCell', () => {
  it('rejects cup fill levels and foam depths, which are not ingredients', () => {
    ['130', '100 /120', '0.5 cm', '1.5 cm', '220g Fill cup', '100g Line cup', '', '   ']
      .forEach(t => expect(isNoiseCell(t)).toBe(true));
  });

  it('keeps anything naming a real material', () => {
    ['10 ml Salted Caramel', '150ml Spanish Milk', '5g UJI Powder']
      .forEach(t => expect(isNoiseCell(t)).toBe(false));
  });
});

describe('parseIngredientCell - single ingredient', () => {
  it('reads a plain quantity and name', () => {
    expect(one('10 ml Salted Caramel')).toEqual({ qty: 10, unit: 'ml', name: 'Salted Caramel' });
    expect(one('0.7 ml Truffle Oil')).toEqual({ qty: 0.7, unit: 'ml', name: 'Truffle Oil' });
  });

  it('prefers the real weight over the scoop count', () => {
    // "2 scoops 30g" - the scoops are how it is portioned, 30g is how much.
    expect(one('2 scoops 30g Dark Chocolate Powder')).toEqual({ qty: 30, unit: 'g', name: 'Dark Chocolate Powder' });
    expect(one('1 scoops 15g White chocolate Powder')).toEqual({ qty: 15, unit: 'g', name: 'White chocolate Powder' });
  });

  it('handles the weight and scoop count in either order', () => {
    expect(one('15g 1 Scoop Vanilla Powder')).toEqual({ qty: 15, unit: 'g', name: 'Vanilla Powder' });
    expect(one('20g 1 scoop BD Banana jam')).toEqual({ qty: 20, unit: 'g', name: 'BD Banana jam' });
  });

  it('collapses a barista range to its midpoint', () => {
    // "30-35ml" is one espresso shot, not 30 and then 35.
    expect(one('Hot 30-35ml')).toEqual({ qty: 32.5, unit: 'ml', name: '' });
    expect(one('Espresso 30-35ml')).toEqual({ qty: 32.5, unit: 'ml', name: 'Espresso' });
  });

  it('drops a bare temperature label but keeps it when it names a material', () => {
    // "Hot" alone is a variant marker; "Hot water" is a real ingredient.
    expect(one('40ml Hot water')).toEqual({ qty: 40, unit: 'ml', name: 'water' });
    expect(parseIngredientCell('Hot').components).toHaveLength(0);
  });

  it('strips a stranded serving measure from the name', () => {
    expect(one('1g dash Nutmeg Powder')).toEqual({ qty: 1, unit: 'g', name: 'Nutmeg Powder' });
  });

  it('keeps count-based ingredients that have no weight', () => {
    expect(one('1 pc Dried Lemon')).toEqual({ qty: 1, unit: 'pc', name: 'Dried Lemon' });
    expect(one('1 scoop Coconut Jelly')).toEqual({ qty: 1, unit: 'scoop', name: 'Coconut Jelly' });
  });
});

describe('parseIngredientCell - hot / iced variants', () => {
  it('splits one material across two temperatures', () => {
    const r = parseIngredientCell('260ml / 150ml Full Milk');
    expect(r.variants).toEqual([
      { variant: 'hot', qty: 260, unit: 'ml', name: 'Full Milk' },
      { variant: 'iced', qty: 150, unit: 'ml', name: 'Full Milk' },
    ]);
    expect(r.components).toHaveLength(0);
  });

  it('splits two DIFFERENT materials across two temperatures', () => {
    const r = parseIngredientCell('200ml / 150ml Steam Milk / Warm Milk');
    expect(r.variants).toEqual([
      { variant: 'hot', qty: 200, unit: 'ml', name: 'Steam Milk' },
      { variant: 'iced', qty: 150, unit: 'ml', name: 'Warm Milk' },
    ]);
  });

  it('does not treat "w/o" as a separator', () => {
    // "w/o espresso 240ml Biscoff Based" - that slash is part of the word.
    const r = parseIngredientCell('w/o espresso 240ml Biscoff Based');
    const names = [...r.components, ...r.variants].map(x => x.name);
    expect(names.some(n => n === 'w')).toBe(false);
    expect(names.join(' ')).toMatch(/Biscoff Based/);
  });
});

describe('parseIngredientCell - multi-component cells', () => {
  it('reads a foam build as its three materials, with nothing to confirm', () => {
    const r = parseIngredientCell('0.7ml Truffle Oil / 20ml full cream / 20ml everwhip Truffle Foam');
    expect(r.components).toHaveLength(3);
    expect(r.components[0]).toEqual({ qty: 0.7, unit: 'ml', name: 'Truffle Oil' });
    expect(r.components[1]).toEqual({ qty: 20, unit: 'ml', name: 'full cream' });
    // Three parts cannot be a Hot/Iced split - there are only two
    // temperatures - so there is nothing ambiguous here. Flagging it skipped
    // eight perfectly readable drinks.
    expect(r.needsReview).toBe(false);
  });

  it('takes the label of the thing being built off the last material', () => {
    // The wide gap is how the sheet separates the two.
    const r = parseIngredientCell('15g Rocksalted Cheese / 20ml full cream / 20ml everwhip          Rocksalted Cheese Foam');
    expect(r.components.map(c => c.name)).toEqual(['Rocksalted Cheese', 'full cream', 'everwhip']);
    expect(r.label).toBe('Rocksalted Cheese Foam');
  });

  it('keeps a trailing material that is not a label', () => {
    // Nothing but a quantity precedes the gap, so "Breve Milk" IS the material.
    const r = parseIngredientCell('260ml / 150ml          Breve Milk', { sizeCount: 2 });
    expect(r.variants.map(v => v.name)).toEqual(['Breve Milk', 'Breve Milk']);
    expect(r.label).toBe('');
  });

  it('reads a pair on a single-size drink as two materials, not hot and iced', () => {
    // A 12oz iced-only matcha has nothing to split between, and reading this
    // as a temperature split threw the oat milk away.
    const r = parseIngredientCell('40ml / 40ml     Warm water/ Oat Milk', { sizeCount: 1 });
    expect(r.variants).toHaveLength(0);
    expect(r.components).toEqual([
      { qty: 40, unit: 'ml', name: 'water' },
      { qty: 40, unit: 'ml', name: 'Oat Milk' },
    ]);
  });

  it('still splits that pair by temperature when the drink has two sizes', () => {
    const r = parseIngredientCell('200ml / 150ml     Steam Milk / Warm Milk', { sizeCount: 2 });
    expect(r.variants).toEqual([
      { variant: 'hot', qty: 200, unit: 'ml', name: 'Steam Milk' },
      { variant: 'iced', qty: 150, unit: 'ml', name: 'Warm Milk' },
    ]);
  });

  it('treats a w/ or w/o build as one material needing a decision', () => {
    const r = parseIngredientCell('w/o espresso 240ml      Biscoff Based');
    expect(r.components).toEqual([{ qty: 240, unit: 'ml', name: 'Biscoff Based' }]);
    // Which build the menu sells is the operator's call, not the parser's.
    expect(r.needsReview).toBe(true);
  });

  it('does not read a drizzle as part of the material name', () => {
    const r = parseIngredientCell('10ml Drizzle          Caramel Sauce');
    expect(r.components[0].name).toBe('Caramel Sauce');
  });

  it('always keeps the original text for review', () => {
    const raw = '10ml Condensed /2 scoops Egg pudding / 20ml Spanish Milk';
    expect(parseIngredientCell(raw).raw).toBe(raw);
  });
});

describe('parseBulkRecipes', () => {
  // Shape of the real sheet: the table lives in columns 4-8.
  const rows = [
    ['', '', '', '', 'Spanish Milk Bulk (2077ml)', '', '', '', ''],
    ['', '', '', '', 'INGREDIENTS', 'SIZE', 'UNIT', 'UNIT COST', 'USED UNITS'],
    ['', '', '', '', 'Alaska Condensed Milk', 377, 'ml', 66, 377],
    ['', '', '', '', 'Alaska Barista Milk', 1000, 'ml', 82, 1700],
    ['', '', '', '', 'Total Cost', '', '', '', ''],
  ];

  it('reads the name, yield and ingredients', () => {
    const [r] = parseBulkRecipes(rows);
    expect(r.name).toBe('Spanish Milk Bulk');
    expect(r.yieldQty).toBe(2077);
    expect(r.yieldUnit).toBe('ml');
    expect(r.ingredients).toHaveLength(2);
  });

  it('derives cost per base unit from the purchase pack, not the used amount', () => {
    const [r] = parseBulkRecipes(rows);
    // 1000ml pack costs 82, so 0.082/ml - even though 1700ml is consumed.
    const barista = r.ingredients.find(i => i.name === 'Alaska Barista Milk');
    expect(barista.costPerUnit).toBeCloseTo(0.082, 4);
    expect(barista.qty).toBe(1700);
    expect(barista.packSize).toBe(1000);
  });

  it('ignores the Total Cost footer and empty blocks', () => {
    expect(parseBulkRecipes([...rows, ['', '', '', '', 'Total Cost', '', '', '', '']])).toHaveLength(1);
    expect(parseBulkRecipes([])).toEqual([]);
  });
});

describe('parseDrinkSheet', () => {
  const rows = [
    [' INFU COFFEE ', '', '', '', '', '', ''],
    ['SIGNATURE COFFEE', 'CUP MARK', 'Size', 'Cups', 'Espresso', 'Syrup', 'Procedure'],
    ['SEASALT', 'SS', '12oz / 16oz', 'DW / PET', 'Hot 30-35ml', '10 ml Sea Salt', 'Mix well'],
    // Column meanings differ per section - Procedure and Milk swap places here.
    ['MATCHA SLOWBAR', 'CUP MARK', 'Size', 'Cups', 'Hot Water', 'Procedure', 'Milk'],
    ['UJI', 'UJI', '12oz', 'PET', '40ml Warm water', 'Whisk Well', '150ml Oat Milk'],
  ];

  it('reads drinks under their section and skips banner rows', () => {
    const drinks = parseDrinkSheet(rows);
    expect(drinks.map(d => d.name)).toEqual(['SEASALT', 'UJI']);
    expect(drinks[0].section).toBe('SIGNATURE COFFEE');
    expect(drinks[1].section).toBe('MATCHA SLOWBAR');
    expect(drinks[0].cupMark).toBe('SS');
  });

  it('reads ingredient columns by their header, not a fixed position', () => {
    const [, uji] = parseDrinkSheet(rows);
    // 'Procedure' must be skipped even though it sits where 'Syrup' did above.
    expect(uji.ingredients.map(i => i.column)).toEqual(['Hot Water', 'Milk']);
    expect(uji.ingredients[1].components[0]).toEqual({ qty: 150, unit: 'ml', name: 'Oat Milk' });
  });

  it('never treats Procedure, Size, Cups or Ice as ingredients', () => {
    for (const d of parseDrinkSheet(rows)) {
      expect(d.ingredients.some(i => /procedure|size|cups|ice/i.test(i.column))).toBe(false);
    }
  });
});

describe('collectMaterials', () => {
  it('merges the same material across drinks and bulk recipes, counting uses', () => {
    const drinks = parseDrinkSheet([
      ['X', 'CUP MARK', 'Size', 'Cups', 'Milk'],
      ['A', 'A', '12oz', 'PET', '150ml Full Milk'],
      ['B', 'B', '12oz', 'PET', '100ml full milk'],
    ]);
    const mats = collectMaterials({ drinks });
    const milk = mats.find(m => m.name.toLowerCase() === 'full milk');
    expect(milk.uses).toBe(2); // case-insensitive merge
  });

  it('records every unit a material appears in, so mismatches are visible', () => {
    const bulkRecipes = [{
      name: 'X', ingredients: [
        { name: 'Hibiscus Tea', unit: 'g', qty: 20 },
        { name: 'Hibiscus Tea', unit: 'ml', qty: 150 },
      ],
    }];
    const [m] = collectMaterials({ bulkRecipes });
    expect(m.units.sort()).toEqual(['g', 'ml']);
  });

  it('is empty for empty input', () => {
    expect(collectMaterials()).toEqual([]);
  });
});

describe('parseSizes', () => {
  it('splits paired volumes and temperatures, in order', () => {
    // Volume order matches variant order: hot first, then iced.
    expect(parseSizes('12oz / 16oz Hot / Iced').map(s => s.name)).toEqual(['12oz Hot', '16oz Iced']);
    expect(parseSizes('8oz / 12oz Hot / Iced').map(s => s.name)).toEqual(['8oz Hot', '12oz Iced']);
  });

  it('keeps two sizes even when the volumes are identical', () => {
    // A hot 12oz and an iced 12oz are different drinks with different recipes.
    expect(parseSizes('12oz / 12oz Hot / Iced').map(s => s.name)).toEqual(['12oz Hot', '12oz Iced']);
  });

  it('reads a single size, with or without a temperature', () => {
    expect(parseSizes('16oz Iced').map(s => s.name)).toEqual(['16oz Iced']);
    expect(parseSizes('2oz Hot').map(s => s.name)).toEqual(['2oz Hot']);
    expect(parseSizes('16oz').map(s => s.name)).toEqual(['16oz']);
  });

  it('records which ingredient variant each size takes', () => {
    const [hot, iced] = parseSizes('12oz / 16oz Hot / Iced');
    expect(hot.variantIndex).toBe(0);
    expect(iced.variantIndex).toBe(1);
  });

  it('applies one temperature across several volumes', () => {
    expect(parseSizes('8oz / 12oz Iced').map(s => s.name)).toEqual(['8oz Iced', '12oz Iced']);
  });

  it('is empty when there is no size at all', () => {
    expect(parseSizes('')).toEqual([]);
    expect(parseSizes('Hot')).toEqual([]);
    expect(parseSizes(undefined)).toEqual([]);
  });
});

describe('buildProductDraft', () => {
  const drink = (over = {}) => ({
    name: 'Latte', section: 'Coffee', sizes: '12oz / 16oz Hot / Iced',
    ingredients: [
      { column: 'Espresso', tempHint: '', components: [{ qty: 30, unit: 'ml', name: 'Espresso' }], variants: [] },
      { column: 'Milk', tempHint: '', components: [], variants: [
        { variant: 'hot', qty: 200, unit: 'ml', name: 'Steam Milk' },
        { variant: 'iced', qty: 150, unit: 'ml', name: 'Full Milk' },
      ] },
    ],
    ...over,
  });

  it('puts the hot quantities on the base size and the iced on an extra size', () => {
    const p = buildProductDraft(drink());
    expect(p.baseSizeName).toBe('12oz Hot');
    expect(p.baseRecipe).toEqual([
      { name: 'Espresso', qty: 30, unit: 'ml' },
      { name: 'Steam Milk', qty: 200, unit: 'ml' },
    ]);
    expect(p.sizes).toHaveLength(1);
    expect(p.sizes[0].name).toBe('16oz Iced');
    expect(p.sizes[0].recipe).toEqual([
      { name: 'Espresso', qty: 30, unit: 'ml' },
      { name: 'Full Milk', qty: 150, unit: 'ml' },
    ]);
  });

  it('repeats ingredients that do not vary by temperature on every size', () => {
    const p = buildProductDraft(drink());
    // Espresso has no variant, so both sizes get it - once each, not twice.
    expect(p.baseRecipe.filter(r => r.name === 'Espresso')).toHaveLength(1);
    expect(p.sizes[0].recipe.filter(r => r.name === 'Espresso')).toHaveLength(1);
  });

  it('routes a temperature-specific COLUMN to its own size only', () => {
    // Some sections use two same-named columns instead of a slashed cell.
    // Left shared, the drink would get two shots in every cup.
    const p = buildProductDraft(drink({
      ingredients: [
        { column: 'Espresso', tempHint: 'hot', components: [{ qty: 30, unit: 'ml', name: 'Espresso' }], variants: [] },
        { column: 'Espresso', tempHint: 'iced', components: [{ qty: 35, unit: 'ml', name: 'Espresso' }], variants: [] },
      ],
    }));
    expect(p.baseRecipe).toEqual([{ name: 'Espresso', qty: 30, unit: 'ml' }]);
    expect(p.sizes[0].recipe).toEqual([{ name: 'Espresso', qty: 35, unit: 'ml' }]);
  });

  it('names the base size even when there is only one', () => {
    const p = buildProductDraft(drink({ sizes: '16oz Iced' }));
    expect(p.baseSizeName).toBe('16oz Iced');
    expect(p.sizes).toHaveLength(0);
    // With one size the iced variant is the only one, so it lands on the base.
    expect(p.baseRecipe.some(r => r.name === 'Steam Milk')).toBe(true);
  });

  it('carries the section through as the product category', () => {
    expect(buildProductDraft(drink()).category).toBe('Coffee');
    expect(buildProductDraft(drink({ section: '' })).category).toBe('Uncategorized');
  });

  it('preserves the review flag', () => {
    expect(buildProductDraft(drink({ needsReview: true })).needsReview).toBe(true);
  });
});
