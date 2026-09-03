// Menu backup / restore: a lossless round-trip of the whole menu, so rebuilding
// a database does not mean rebuilding every product and recipe by hand.
//
// The load-bearing case is the SECOND one: restoring into a database where the
// Inventory has been rebuilt and every invId is different. Recipes have to
// re-link by ingredient name, or every restored product silently loses its
// COGS.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { bootApp, makeUser, loginStaff } from './helpers/harness.js';

let ctx, app, tok;
const auth = (m, p) => request(app)[m](p).set('Authorization', `Bearer ${tok}`);

beforeAll(async () => {
  ctx = await bootApp({ businessType: 'fb' });
  app = ctx.app;
  await makeUser({ name: 'MenuSuper', role: 'superadmin' });
  tok = await loginStaff(app, 'MenuSuper');
}, 120000);

afterAll(async () => { await ctx.stop(); });

const Product = () => mongoose.model('Product');
const Inventory = () => mongoose.model('Inventory');

beforeEach(async () => {
  // Every collection the backup touches, so one test's seed cannot leak into
  // the next one's counts.
  for (const n of ['Product', 'Inventory', 'Category', 'ModifierGroup', 'AddOn', 'Discount', 'DiscountRule', 'Combo']) {
    await mongoose.model(n).deleteMany({});
  }
});

async function makeInventory(itemName, unit = 'ml', unitCost = 0.5, itemCode = 'RM-0001') {
  return Inventory().create({ itemCode, itemName, unit, stockQty: 10000, unitCost });
}

async function makeProduct(over = {}) {
  const milk = await Inventory().findOne({ itemName: 'Full Milk' });
  return Product().create({
    productCode: 'BEV-0001', name: 'Spanish Latte', category: 'Coffee', basePrice: 150,
    baseRecipe: milk ? [{ invId: String(milk._id), name: 'Full Milk', qty: 150, cost: 0.5, unit: 'ml' }] : [],
    sizes: [{ sizeCode: 'L', name: 'Large', price: 180, recipe: milk ? [{ invId: String(milk._id), name: 'Full Milk', qty: 220, cost: 0.5, unit: 'ml' }] : [] }],
    ...over,
  });
}

describe('exporting a menu backup', () => {
  it('carries products, sizes and recipes with ingredient names', async () => {
    await makeInventory('Full Milk');
    await makeProduct();

    const res = await auth('get', '/api/products/menu-backup');
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(1);
    expect(res.body.counts.products).toBe(1);

    const [p] = res.body.products;
    expect(p.name).toBe('Spanish Latte');
    expect(p.basePrice).toBe(150);
    // The NAME is what survives a rebuild - it must be in the file.
    expect(p.baseRecipe[0]).toMatchObject({ name: 'Full Milk', qty: 150, unit: 'ml' });
    expect(p.sizes[0]).toMatchObject({ sizeCode: 'L', price: 180 });
    expect(p.sizes[0].recipe[0].name).toBe('Full Milk');
  });

  it('carries the stock item code on every recipe line', async () => {
    await makeInventory('Full Milk', 'ml', 0.5, 'RM-MILK-01');
    await makeProduct();

    const [p] = (await auth('get', '/api/products/menu-backup')).body.products;
    expect(p.baseRecipe[0].itemCode).toBe('RM-MILK-01');
    expect(p.sizes[0].recipe[0].itemCode).toBe('RM-MILK-01');
  });

  it('excludes archived products unless asked', async () => {
    await makeInventory('Full Milk');
    await makeProduct({ name: 'Retired Drink', productCode: 'BEV-0009', isArchived: true });

    expect((await auth('get', '/api/products/menu-backup')).body.counts.products).toBe(0);
    expect((await auth('get', '/api/products/menu-backup?includeArchived=true')).body.counts.products).toBe(1);
  });
});

describe('restoring into a rebuilt database', () => {
  it('re-links recipes by name when every invId has changed', async () => {
    await makeInventory('Full Milk');
    await makeProduct();
    const backup = (await auth('get', '/api/products/menu-backup')).body;
    const oldInvId = backup.products[0].baseRecipe[0].invId;

    // Simulate the rebuild: wipe everything and recreate stock with NEW ids.
    await Product().deleteMany({});
    await Inventory().deleteMany({});
    const rebuilt = await makeInventory('Full Milk', 'ml', 0.75);
    expect(String(rebuilt._id)).not.toBe(oldInvId);

    const res = await auth('post', '/api/products/menu-backup/restore').send({ backup });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);
    expect(res.body.unmatchedIngredients).toEqual([]);

    const restored = await Product().findOne({ name: 'Spanish Latte' }).lean();
    expect(restored.baseRecipe[0].invId).toBe(String(rebuilt._id)); // relinked
    expect(restored.baseRecipe[0].qty).toBe(150);
    // Cost is re-read from CURRENT stock, not carried over from the backup.
    expect(restored.baseRecipe[0].cost).toBe(0.75);
    expect(restored.sizes[0].recipe[0].qty).toBe(220);
  });

  it('re-links by stock code even when the item has been RENAMED', async () => {
    // The case name-matching alone cannot survive: same stock, new label.
    await makeInventory('Full Milk', 'ml', 0.5, 'RM-MILK-01');
    await makeProduct();
    const backup = (await auth('get', '/api/products/menu-backup')).body;

    await Product().deleteMany({});
    await Inventory().deleteMany({});
    const renamed = await makeInventory('Alaska Barista Fresh Milk', 'ml', 0.9, 'RM-MILK-01');

    const res = await auth('post', '/api/products/menu-backup/restore').send({ backup });
    expect(res.body.unmatchedIngredients).toEqual([]);
    expect(res.body.matchedBy.itemCode).toBeGreaterThan(0);
    expect(res.body.matchedBy.name).toBe(0);

    const restored = await Product().findOne({ name: 'Spanish Latte' }).lean();
    expect(restored.baseRecipe[0].invId).toBe(String(renamed._id));
    expect(restored.baseRecipe[0].name).toBe('Alaska Barista Fresh Milk'); // takes the CURRENT name
    expect(restored.baseRecipe[0].qty).toBe(150);
  });

  it('still falls back to the name when the stock code has changed', async () => {
    await makeInventory('Full Milk', 'ml', 0.5, 'RM-MILK-01');
    await makeProduct();
    const backup = (await auth('get', '/api/products/menu-backup')).body;

    await Product().deleteMany({});
    await Inventory().deleteMany({});
    await makeInventory('Full Milk', 'ml', 0.5, 'RM-TOTALLY-DIFFERENT');

    const res = await auth('post', '/api/products/menu-backup/restore').send({ backup });
    expect(res.body.unmatchedIngredients).toEqual([]);
    expect(res.body.matchedBy.name).toBeGreaterThan(0);
  });

  it('reports an ingredient it cannot find instead of dropping it silently', async () => {
    await makeInventory('Full Milk');
    await makeProduct();
    const backup = (await auth('get', '/api/products/menu-backup')).body;

    await Product().deleteMany({});
    await Inventory().deleteMany({});   // the ingredient no longer exists at all

    const res = await auth('post', '/api/products/menu-backup/restore').send({ backup });
    expect(res.body.created).toBe(1);
    expect(res.body.unmatchedIngredients).toContain('Full Milk');
    const restored = await Product().findOne({ name: 'Spanish Latte' }).lean();
    expect(restored.baseRecipe).toHaveLength(0); // reported, not silently wrong
  });

  it('refuses to match an ingredient tracked in a different dimension', async () => {
    await makeInventory('Full Milk');
    await makeProduct();
    const backup = (await auth('get', '/api/products/menu-backup')).body;

    await Product().deleteMany({});
    await Inventory().deleteMany({});
    await makeInventory('Full Milk', 'pcs', 3); // same name, but counted not poured

    const res = await auth('post', '/api/products/menu-backup/restore').send({ backup });
    expect(res.body.unmatchedIngredients.join(' ')).toMatch(/Full Milk/);
    const restored = await Product().findOne({ name: 'Spanish Latte' }).lean();
    expect(restored.baseRecipe).toHaveLength(0);
  });

  it('keeps the original product code when it is still free', async () => {
    await makeInventory('Full Milk');
    await makeProduct();
    const backup = (await auth('get', '/api/products/menu-backup')).body;
    await Product().deleteMany({});

    await auth('post', '/api/products/menu-backup/restore').send({ backup });
    expect((await Product().findOne({ name: 'Spanish Latte' }).lean()).productCode).toBe('BEV-0001');
  });
});

describe('the rest of the menu, not just products', () => {
  const M = (n) => mongoose.model(n);

  async function seedEverything() {
    await makeInventory('Full Milk', 'ml', 0.5, 'RM-MILK-01');
    await makeProduct();
    await M('Category').create({ name: 'Coffee', department: 'Bar' });
    await M('ModifierGroup').create({
      name: 'Sugar Level', isRequired: false, minSelect: 0, maxSelect: 3,
      options: [{ name: '50%', price: 0 }, { name: 'Extra', price: 10 }],
    });
    await M('AddOn').create({ name: 'Extra Shot', price: 30, category: 'Coffee Extras' });
    await M('Discount').create({ name: 'Senior Citizen', percentage: 20, isSCPWD: true });
    await M('DiscountRule').create({ name: 'Happy Hour', percent: 15, priority: 2, daysOfWeek: [1, 2], minSubtotal: 200 });
    await M('Combo').create({
      name: 'Latte + Shot', price: 170, isActive: true,
      items: [{ productId: 'x', name: 'Spanish Latte', sizeName: '', quantity: 1 }],
    });
  }

  async function wipeAll() {
    for (const n of ['Product', 'Inventory', 'Category', 'ModifierGroup', 'AddOn', 'Discount', 'DiscountRule', 'Combo']) {
      await M(n).deleteMany({});
    }
  }

  it('exports every menu-shaping record, not only products', async () => {
    await seedEverything();
    const b = (await auth('get', '/api/products/menu-backup')).body;

    expect(b.counts).toMatchObject({
      products: 1, categories: 1, modifierGroups: 1, addOns: 1, discounts: 1, discountRules: 1,
    });
    expect(b.categories[0]).toMatchObject({ name: 'Coffee', department: 'Bar' });
    expect(b.addOns[0]).toMatchObject({ name: 'Extra Shot', price: 30, category: 'Coffee Extras' });
    expect(b.discounts[0]).toMatchObject({ name: 'Senior Citizen', percentage: 20, isSCPWD: true });
    expect(b.discountRules[0]).toMatchObject({ name: 'Happy Hour', percent: 15, priority: 2, minSubtotal: 200 });
    expect(b.combos[0]).toMatchObject({ name: 'Latte + Shot', price: 170 });
  });

  it('keeps the modifier group selection rules', async () => {
    await seedEverything();
    const b = (await auth('get', '/api/products/menu-backup')).body;
    // These are the fields that actually drive the POS prompt - losing them
    // would turn an optional 0-3 pick into a forced single choice.
    expect(b.modifierGroups[0]).toMatchObject({ name: 'Sugar Level', isRequired: false, minSelect: 0, maxSelect: 3 });
    expect(b.modifierGroups[0].options).toHaveLength(2);
  });

  it('restores them all into an empty database', async () => {
    await seedEverything();
    const backup = (await auth('get', '/api/products/menu-backup')).body;
    await wipeAll();
    await makeInventory('Full Milk', 'ml', 0.5, 'RM-MILK-01');

    const res = await auth('post', '/api/products/menu-backup/restore').send({ backup });
    expect(res.status).toBe(200);
    expect(res.body.added).toMatchObject({
      categories: 1, modifierGroups: 1, addOns: 1, discounts: 1, discountRules: 1, combos: 1,
    });

    const g = await M('ModifierGroup').findOne({ name: 'Sugar Level' }).lean();
    expect(g).toMatchObject({ isRequired: false, minSelect: 0, maxSelect: 3 });
    const rule = await M('DiscountRule').findOne({ name: 'Happy Hour' }).lean();
    expect(rule).toMatchObject({ percent: 15, minSubtotal: 200 });
    expect(rule.daysOfWeek).toEqual([1, 2]);
  });

  it('re-points a combo at the restored product, not the old id', async () => {
    await seedEverything();
    const backup = (await auth('get', '/api/products/menu-backup')).body;
    await wipeAll();
    await makeInventory('Full Milk', 'ml', 0.5, 'RM-MILK-01');

    await auth('post', '/api/products/menu-backup/restore').send({ backup });
    const product = await M('Product').findOne({ name: 'Spanish Latte' }).lean();
    const combo = await M('Combo').findOne({ name: 'Latte + Shot' }).lean();
    expect(combo.items[0].productId).toBe(String(product._id));
  });

  it('refuses to build a combo whose component product is missing', async () => {
    await seedEverything();
    const backup = (await auth('get', '/api/products/menu-backup')).body;
    backup.products = []; // the combo's component never gets restored
    await wipeAll();

    const res = await auth('post', '/api/products/menu-backup/restore').send({ backup });
    expect(res.body.added.combos).toBe(0);
    expect(res.body.incompleteCombos).toEqual([{ combo: 'Latte + Shot', missing: ['Spanish Latte'] }]);
    expect(await M('Combo').countDocuments({})).toBe(0); // never half-built
  });

  it('leaves an existing discount rule alone rather than overwriting from a stale file', async () => {
    await seedEverything();
    const backup = (await auth('get', '/api/products/menu-backup')).body;
    backup.discountRules[0].percent = 90; // stale, dangerously wrong

    const res = await auth('post', '/api/products/menu-backup/restore').send({ backup });
    expect(res.body.added.discountRules).toBe(0);
    // What customers are charged must not change because of an old backup.
    expect((await M('DiscountRule').findOne({ name: 'Happy Hour' }).lean()).percent).toBe(15);
  });
});

describe('restoring over a live menu', () => {
  it('skips products already on the menu by default', async () => {
    await makeInventory('Full Milk');
    await makeProduct();
    const backup = (await auth('get', '/api/products/menu-backup')).body;
    backup.products[0].basePrice = 999; // a stale price in the backup

    const res = await auth('post', '/api/products/menu-backup/restore').send({ backup });
    expect(res.body.skipped).toBe(1);
    expect(res.body.created).toBe(0);
    // Hand-tuned pricing must not be clobbered by a stale file.
    expect((await Product().findOne({ name: 'Spanish Latte' }).lean()).basePrice).toBe(150);
  });

  it('overwrites only when explicitly asked', async () => {
    await makeInventory('Full Milk');
    await makeProduct();
    const backup = (await auth('get', '/api/products/menu-backup')).body;
    backup.products[0].basePrice = 999;

    const res = await auth('post', '/api/products/menu-backup/restore').send({ backup, onConflict: 'overwrite' });
    expect(res.body.updated).toBe(1);
    expect((await Product().findOne({ name: 'Spanish Latte' }).lean()).basePrice).toBe(999);
  });

  it('changes nothing on a dry run', async () => {
    await makeInventory('Full Milk');
    await makeProduct();
    const backup = (await auth('get', '/api/products/menu-backup')).body;
    await Product().deleteMany({});

    const res = await auth('post', '/api/products/menu-backup/restore').send({ backup, dryRun: true });
    expect(res.body.dryRun).toBe(true);
    expect(res.body.created).toBe(1);
    expect(await Product().countDocuments({})).toBe(0); // nothing written
  });
});

describe('rejecting a bad file', () => {
  it('refuses something that is not a menu backup', async () => {
    const res = await auth('post', '/api/products/menu-backup/restore').send({ backup: { hello: 'world' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not look like a menu backup/i);
  });

  it('refuses a backup from a newer version than this server understands', async () => {
    const res = await auth('post', '/api/products/menu-backup/restore')
      .send({ backup: { version: 99, products: [] } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/newer version/i);
  });
});
