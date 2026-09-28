// Put a product back on the menu once what it is made from is back in stock.
//
// A sale that drains an ingredient to zero takes every product using it off
// the menu (orders.js, "Auto-mark products unavailable") - but nothing ever put
// them back, so a restock left the drink hidden until someone remembered to
// restore it by hand. Those automatic removals are flagged `autoUnavailable`,
// and only those are restored here: a product a person removed stays removed.
//
// The rule mirrors the removal: a product comes back when EVERY ingredient its
// recipes use (base, sizes, add-ons) has stock above zero again.

function recipeInvIds(p) {
  const ids = new Set();
  const take = (lines) => { for (const l of lines || []) if (l?.invId) ids.add(String(l.invId)); };
  take(p.baseRecipe);
  for (const s of p.sizes || []) take(s.recipe);
  for (const a of p.addOns || []) take(a.recipe);
  return [...ids];
}

export async function restoreAutoRemovedProducts({ Product, Inventory }) {
  const candidates = await Product.find(
    { autoUnavailable: true, isAvailable: false },
    { name: 1, baseRecipe: 1, sizes: 1, addOns: 1 },
  ).lean();
  if (!candidates.length) return [];

  const allIds = [...new Set(candidates.flatMap(recipeInvIds))];
  const stock = new Map(
    (await Inventory.find({ _id: { $in: allIds } }, { stockQty: 1 }).lean())
      .map((i) => [String(i._id), Number(i.stockQty) || 0]),
  );

  const restore = candidates.filter((p) => {
    const ids = recipeInvIds(p);
    // An ingredient that no longer exists is not "back in stock".
    return ids.length > 0 && ids.every((id) => (stock.get(id) || 0) > 0);
  });
  if (!restore.length) return [];

  // Guarded on the flag again so a product someone removed by hand in the
  // meantime (which clears the flag) is not brought back.
  await Product.updateMany(
    { _id: { $in: restore.map((p) => p._id) }, autoUnavailable: true, isAvailable: false },
    { $set: { isAvailable: true, autoUnavailable: false } },
  );
  return restore.map((p) => p.name);
}

// Runs the check shortly after stock changes (debounced: a PO receipt writes
// many lines at once, and a transaction's writes are only visible once it
// commits), and on a slow timer as a backstop for any path that changes stock
// some other way.
export function createAutoRestorer({ Product, Inventory, log, onRestored, delayMs = 1500, intervalMs = 60_000 }) {
  let timer = null;
  let running = false;
  const run = async () => {
    timer = null;
    if (running) { schedule(); return; }
    running = true;
    try {
      const names = await restoreAutoRemovedProducts({ Product, Inventory });
      if (names.length) {
        log?.info?.({ products: names }, 'Auto-restored products - ingredients back in stock');
        onRestored?.(names);
      }
    } catch (err) {
      log?.warn?.({ err }, 'auto-restore check failed');
    } finally { running = false; }
  };
  const schedule = () => { if (!timer) timer = setTimeout(run, delayMs); };
  const interval = intervalMs ? setInterval(run, intervalMs) : null;
  interval?.unref?.();
  return { schedule, runNow: run, stop: () => { if (timer) clearTimeout(timer); if (interval) clearInterval(interval); } };
}
