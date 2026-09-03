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
  it('returns each component and flags the cell for review', () => {
    const r = parseIngredientCell('0.7ml Truffle Oil / 20ml full cream / 20ml everwhip Truffle Foam');
    expect(r.components).toHaveLength(3);
    expect(r.components[0]).toEqual({ qty: 0.7, unit: 'ml', name: 'Truffle Oil' });
    expect(r.components[1]).toEqual({ qty: 20, unit: 'ml', name: 'full cream' });
    // Ambiguous by nature, so a human confirms rather than the parser guessing.
    expect(r.needsReview).toBe(true);
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
