// Attach or remove add-ons across many products at once - all of them, some
// categories, or a hand-picked list - instead of opening every product.
// The server writes what ticking the add-on inside a product writes; a product
// that already has one keeps its own price and recipe for it.
import { useMemo, useState } from 'react';
import { Link2, Unlink } from 'lucide-react';
import * as ui from '../../shared/ui';

export default function LinkAddOns({ addOns = [], products = [], categories = [], apiFetch, onDone }) {
  const [picked, setPicked] = useState(() => new Set());
  const [scope, setScope] = useState('all');           // all | categories | products
  const [cats, setCats] = useState(() => new Set());
  const [prods, setProds] = useState(() => new Set());
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  const live = products.filter((p) => !p.isArchived);
  const targets = useMemo(() => {
    if (scope === 'all') return live;
    if (scope === 'categories') return live.filter((p) => cats.has(p.category));
    return live.filter((p) => prods.has(String(p._id)));
  }, [scope, cats, prods, live]);
  const chosenAddOns = addOns.filter((a) => picked.has(String(a._id)));

  // How many of the chosen products each add-on would actually change.
  const effect = (action) => chosenAddOns.map((a) => {
    const has = targets.filter((p) => (p.addOns || []).some((x) => x.name === a.name)).length;
    return { name: a.name, n: action === 'attach' ? targets.length - has : has };
  });
  const attachGain = effect('attach').reduce((s, e) => s + e.n, 0);
  const detachGain = effect('detach').reduce((s, e) => s + e.n, 0);

  const toggle = (set, setter, v) => { const next = new Set(set); next.has(v) ? next.delete(v) : next.add(v); setter(next); };
  const shownProducts = live.filter((p) => !q.trim() || `${p.name} ${p.category}`.toLowerCase().includes(q.trim().toLowerCase()));

  const run = async (action) => {
    if (!chosenAddOns.length || !targets.length) return;
    const verb = action === 'attach' ? 'Attach' : 'Remove';
    const n = action === 'attach' ? attachGain : detachGain;
    if (!n) { ui.alert(action === 'attach' ? 'Those products already have every add-on you picked.' : 'None of those products has the add-ons you picked.'); return; }
    if (!(await ui.confirm(`${verb} ${chosenAddOns.map((a) => a.name).join(', ')} ${action === 'attach' ? 'to' : 'from'} ${targets.length} product(s)? ${n} change(s) in all.`))) return;
    setBusy(true);
    try {
      const target = scope === 'all' ? { all: true }
        : scope === 'categories' ? { categories: [...cats] }
          : { productIds: [...prods] };
      const d = await (await apiFetch('/api/addons/link', {
        method: 'POST', body: JSON.stringify({ addOnIds: [...picked], target, action }),
      })).json();
      if (!d.success) { ui.alert(d.error || 'Could not update the products.'); return; }
      const lines = d.perAddOn.map((x) => `${x.name}: ${x.changed} product(s)`).join('\n');
      ui.toast(`${action === 'attach' ? 'Attached' : 'Removed'}.\n${lines}`, { tone: 'success' });
      onDone?.();
    } catch {
      ui.alert('No connection to the server.');
    } finally { setBusy(false); }
  };

  const box = 'flex items-center gap-2 px-3 py-2 rounded-lg border text-sm cursor-pointer transition';
  const on = 'border-brand bg-brand/10 text-fg';
  const off = 'border-white/10 text-fg/80 hover:bg-white/5';

  return (
    <div className="mt-6 border border-white/10 rounded-xl p-4 space-y-4 bg-page-bg/40">
      <div>
        <h4 className="text-sm font-black uppercase tracking-wider text-fg">Link add-ons to products</h4>
        <p className="text-xs text-fg/75 mt-1">Pick add-ons and the products they belong on - all of them, some categories, or specific ones. A product that already has an add-on keeps its own price and recipe for it.</p>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[11px] font-black uppercase tracking-widest text-fg/75">1. Add-ons</p>
          <button type="button" className="text-xs font-bold text-brand-text hover:underline"
            onClick={() => setPicked(picked.size === addOns.length ? new Set() : new Set(addOns.map((a) => String(a._id))))}>
            {picked.size === addOns.length && addOns.length ? 'Clear' : 'All add-ons'}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {addOns.length === 0 && <p className="text-xs text-fg/70">No add-ons yet - add one above first.</p>}
          {addOns.map((a) => {
            const onIt = picked.has(String(a._id));
            const count = live.filter((p) => (p.addOns || []).some((x) => x.name === a.name)).length;
            return (
              <label key={a._id} className={`${box} ${onIt ? on : off}`}>
                <input type="checkbox" className="accent-brand" checked={onIt} onChange={() => toggle(picked, setPicked, String(a._id))} />
                <span className="font-bold">{a.name}</span>
                <span className="text-xs text-fg/70">on {count} of {live.length}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div>
        <p className="text-[11px] font-black uppercase tracking-widest text-fg/75 mb-2">2. Products</p>
        <div className="flex flex-wrap gap-2 mb-3" role="radiogroup" aria-label="Which products">
          {[['all', `All products (${live.length})`], ['categories', 'By category'], ['products', 'Specific products']].map(([v, label]) => (
            <label key={v} className={`${box} ${scope === v ? on : off}`}>
              <input type="radio" name="link-scope" className="accent-brand" checked={scope === v} onChange={() => setScope(v)} /> {label}
            </label>
          ))}
        </div>
        {scope === 'categories' && (
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => {
              const n = live.filter((p) => p.category === c.name).length;
              return (
                <label key={c._id} className={`${box} ${cats.has(c.name) ? on : off}`}>
                  <input type="checkbox" className="accent-brand" checked={cats.has(c.name)} onChange={() => toggle(cats, setCats, c.name)} />
                  {c.name} <span className="text-xs text-fg/70">({n})</span>
                </label>
              );
            })}
          </div>
        )}
        {scope === 'products' && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2 items-center">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type to find products" aria-label="Find products"
                className="flex-1 min-w-[200px] bg-surface border border-white/10 rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-brand" />
              <button type="button" className="text-xs font-bold text-brand-text hover:underline"
                onClick={() => setProds(new Set([...prods, ...shownProducts.map((p) => String(p._id))]))}>Tick all shown</button>
              <button type="button" className="text-xs font-bold text-fg/75 hover:underline" onClick={() => setProds(new Set())}>Clear</button>
            </div>
            <div className="max-h-56 overflow-y-auto grid sm:grid-cols-2 gap-1.5 pr-1">
              {shownProducts.map((p) => (
                <label key={p._id} className={`${box} ${prods.has(String(p._id)) ? on : off}`}>
                  <input type="checkbox" className="accent-brand" checked={prods.has(String(p._id))} onChange={() => toggle(prods, setProds, String(p._id))} />
                  <span className="truncate">{p.name}</span>
                  <span className="ml-auto text-xs text-fg/70 shrink-0">{p.category}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-white/10">
        <p className="text-xs text-fg/80 flex-1 min-w-[200px] pt-3">
          {chosenAddOns.length && targets.length
            ? `${chosenAddOns.length} add-on(s) × ${targets.length} product(s): attaching adds ${attachGain}, removing takes away ${detachGain}.`
            : 'Pick at least one add-on and one product.'}
        </p>
        <div className="flex gap-2 pt-3">
          <button type="button" onClick={() => run('detach')} disabled={busy || !detachGain}
            className="flex items-center gap-1.5 border border-white/15 text-fg/80 hover:text-fg hover:bg-white/5 px-3 py-2 rounded-lg text-xs font-black uppercase tracking-wider disabled:opacity-50">
            <Unlink size={13} /> Remove from these
          </button>
          <button type="button" onClick={() => run('attach')} disabled={busy || !attachGain}
            className="flex items-center gap-1.5 bg-brand hover:bg-brand-dark text-on-brand px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider disabled:opacity-50">
            <Link2 size={13} /> Attach
          </button>
        </div>
      </div>
    </div>
  );
}
