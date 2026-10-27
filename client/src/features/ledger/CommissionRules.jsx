import { useEffect, useState } from 'react';
import { X, ChevronDown, ChevronRight } from 'lucide-react';
import * as ui from '../../shared/ui';

// Commission rates beyond each person's own %: per product, per category, and
// sales tiers (lib/commissions.js on the server says how they combine). Also
// "same % for everyone". Folded until opened; editable by whoever manages users.
export default function CommissionRules({ apiFetch, canEdit, onSaved }) {
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState(null);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [everyone, setEveryone] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || rules) return;
    (async () => {
      try {
        const [r, p, c] = await Promise.all([
          apiFetch('/api/commission-rules').then((x) => x.json()),
          apiFetch('/api/products').then((x) => x.json()).catch(() => ({})),
          apiFetch('/api/categories').then((x) => x.json()).catch(() => ({})),
        ]);
        const got = r.rules || { productRates: [], categoryRates: [], tiers: [] };
        setRules({
          productRates: got.productRates.map((x) => ({ ...x, rate: String(x.rate) })),
          categoryRates: got.categoryRates.map((x) => ({ ...x, rate: String(x.rate) })),
          tiers: got.tiers.map((x) => ({ from: String(x.from), rate: String(x.rate) })),
        });
        setProducts(p.products || []);
        setCategories((c.categories || []).map((x) => x.name).filter(Boolean));
      } catch { ui.alert('Could not load the commission rates.'); }
    })();
  }, [open, rules, apiFetch]);

  const set = (list, i, patch) => setRules({ ...rules, [list]: rules[list].map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const add = (list, row) => setRules({ ...rules, [list]: [...rules[list], row] });
  const drop = (list, i) => setRules({ ...rules, [list]: rules[list].filter((_, j) => j !== i) });

  const save = async () => {
    setBusy(true);
    try {
      const productRates = rules.productRates.map((x) => {
        const p = products.find((pp) => pp.name === x.name);
        return { name: x.name, productId: p?._id || x.productId || '', rate: x.rate };
      });
      const d = await (await apiFetch('/api/commission-rules', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...rules, productRates }) })).json();
      if (!d.success) { ui.alert(d.error || 'Not saved.'); return; }
      ui.toast('Commission rates saved.', { tone: 'success' });
      setRules(null); onSaved?.();
    } catch { ui.alert('Network error - not saved.'); } finally { setBusy(false); }
  };

  const setEveryoneRate = async () => {
    if (!(await ui.confirm({ title: `Set everyone's rate to ${everyone}%?`, message: 'This replaces each person\'s own commission rate. Product, category and tier rates are not changed.', confirmLabel: 'Set rate' }))) return;
    const d = await (await apiFetch('/api/users-commission-rate', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rate: everyone }) })).json();
    if (!d.success) { ui.alert(d.error || 'Not changed.'); return; }
    ui.toast(`Rate set for ${d.changed} account(s).`, { tone: 'success' });
    setEveryone(''); onSaved?.();
  };

  const field = 'bg-page-bg border border-white/10 rounded p-2 text-sm text-fg outline-none disabled:opacity-60';
  const pct = (v, on) => (
    <span className="flex items-center gap-1"><input type="number" min="0" max="100" step="0.1" value={v} disabled={!canEdit}
      onChange={(e) => on(e.target.value)} className={`${field} w-20`} aria-label="Rate in percent" />%</span>
  );
  const rm = (fn, label) => canEdit && <button type="button" onClick={fn} aria-label={label} className="text-fg/70 hover:text-danger"><X size={14} /></button>;
  const addBtn = (fn, label) => canEdit && <button type="button" onClick={fn} className="text-xs text-brand-text hover:text-fg">+ {label}</button>;

  return (
    <div className="bg-surface border border-white/10 rounded-xl">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="w-full flex items-center gap-2 px-4 py-3 text-sm font-bold text-fg hover:bg-white/[0.03] rounded-xl">
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />} Commission rates
        <span className="text-fg/60 font-normal text-xs">per product, per category, sales tiers</span>
      </button>
      {open && (!rules ? <p className="px-4 pb-4 text-sm text-fg/65">Loading…</p> : (
        <div className="px-4 pb-4 space-y-5">
          <p className="text-[11px] text-fg/70">Each item sold earns its product's rate if set, else its category's rate, else the seller's own % (on their account). Someone with no % of their own earns by the tiers, if set. Tiers are like tax brackets over the period shown: e.g. 2% from ₱0, 4% from ₱50,000 means 2% on the first ₱50,000 and 4% on the rest.</p>

          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wider text-fg/80">By product</p>
            {rules.productRates.map((x, i) => (
              <div key={i} className="flex items-center gap-2">
                <input list="cm-products" value={x.name} disabled={!canEdit} onChange={(e) => set('productRates', i, { name: e.target.value, productId: '' })} placeholder="Product" className={`${field} flex-1`} aria-label="Product" />
                {pct(x.rate, (v) => set('productRates', i, { rate: v }))}{rm(() => drop('productRates', i), 'Remove product rate')}
              </div>
            ))}
            <datalist id="cm-products">{products.map((p) => <option key={p._id} value={p.name} />)}</datalist>
            {addBtn(() => add('productRates', { name: '', productId: '', rate: '' }), 'Product rate')}
          </div>

          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wider text-fg/80">By category</p>
            {rules.categoryRates.map((x, i) => (
              <div key={i} className="flex items-center gap-2">
                <input list="cm-categories" value={x.category} disabled={!canEdit} onChange={(e) => set('categoryRates', i, { category: e.target.value })} placeholder="Category" className={`${field} flex-1`} aria-label="Category" />
                {pct(x.rate, (v) => set('categoryRates', i, { rate: v }))}{rm(() => drop('categoryRates', i), 'Remove category rate')}
              </div>
            ))}
            <datalist id="cm-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
            {addBtn(() => add('categoryRates', { category: '', rate: '' }), 'Category rate')}
          </div>

          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wider text-fg/80">Sales tiers</p>
            {rules.tiers.map((x, i) => (
              <div key={i} className="flex items-center gap-2 text-sm text-fg">
                From ₱<input type="number" min="0" value={x.from} disabled={!canEdit} onChange={(e) => set('tiers', i, { from: e.target.value })} className={`${field} w-32`} aria-label="Tier starts at" />
                {pct(x.rate, (v) => set('tiers', i, { rate: v }))}{rm(() => drop('tiers', i), 'Remove tier')}
              </div>
            ))}
            {addBtn(() => add('tiers', { from: rules.tiers.length ? '' : '0', rate: '' }), 'Tier')}
          </div>

          {canEdit && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
              <span className="flex items-center gap-2 text-sm text-fg">
                Everyone's own rate:{pct(everyone, setEveryone)}
                <button type="button" disabled={everyone === ''} onClick={setEveryoneRate}
                  className="px-3 py-2 rounded text-xs font-bold uppercase border border-white/20 text-fg disabled:opacity-40">Set for everyone</button>
              </span>
              <button type="button" disabled={busy} onClick={save}
                className="px-4 py-2 rounded text-xs font-bold uppercase bg-brand text-on-brand disabled:opacity-40">Save rates</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
