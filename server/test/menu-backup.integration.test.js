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
  await Product().deleteMany({});
  await Inventory().deleteMany({});
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
