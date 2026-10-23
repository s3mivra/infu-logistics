import { useState, useEffect, useCallback } from 'react';
import { BookOpen } from 'lucide-react';

// The shared catalog on the Hub: a master list of SKUs that linked branches
// sync into their own products, each keeping its own price if it sets one.
// Transfers and the consolidated books are the Hub's own sections above.
// Server side: server/features/branch-network.js.

export default function BranchNetworkPanel({ authFetch, partners = [], peso = (n) => Number(n || 0).toFixed(2), can = () => true, card, input, btn }) {
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const active = partners.filter(p => p.status === 'active');

  const call = useCallback(async (path, opts) => {
    setErr(''); setMsg('');
    const r = await authFetch(path, opts);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`);
    if (d.warning) setMsg(d.warning);
    return d;
  }, [authFetch]);

  return (
    <div className={card}>
      <h3 className="text-fg font-black uppercase tracking-wider text-sm mb-3 flex items-center gap-2"><BookOpen size={14} /> Shared Catalog</h3>
      {err && <p className="text-danger text-sm mb-3">{err}</p>}
      {msg && <p className="text-warning text-sm mb-3">{msg}</p>}
      <Catalog call={call} setErr={setErr} partners={active} peso={peso} can={can} input={input} btn={btn} />
    </div>
  );
}

function Catalog({ call, setErr, partners, peso, can, input, btn }) {
  const [items, setItems] = useState([]);
  const [links, setLinks] = useState([]);
  const [form, setForm] = useState({ sku: '', name: '', category: '', unit: '', basePrice: '' });
  const [source, setSource] = useState('self');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const manage = can('products.manage');

  const load = useCallback(async () => {
    try {
      const [c, l] = await Promise.all([call('/api/hub/catalog'), call('/api/hub/catalog/links')]);
      setItems(c.items || []); setLinks(l.links || []);
    } catch (e) { setErr(e.message); }
  }, [call, setErr]);
  useEffect(() => { load(); }, [load]);

  const save = async (body) => {
    setBusy(true);
    try { await call('/api/hub/catalog', { method: 'POST', body: JSON.stringify(body) }); setForm({ sku: '', name: '', category: '', unit: '', basePrice: '' }); await load(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };
  const sync = async () => {
    setBusy(true);
    try { setResult(await call('/api/hub/catalog/sync', { method: 'POST', body: JSON.stringify({ sourceSlug: source }) })); await load(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };
  const override = async (sku, raw) => {
    const price = raw === '' ? null : Number(raw);
    try { await call(`/api/hub/catalog/links/${encodeURIComponent(sku)}/override`, { method: 'PUT', body: JSON.stringify({ price }) }); await load(); }
    catch (e) { setErr(e.message); }
  };

  return (
    <div className="space-y-5">
      <section>
        <p className="text-fg/75 text-xs uppercase tracking-widest font-bold mb-2">Sync this branch's menu</p>
        <div className="flex flex-wrap gap-2 items-center">
          <select value={source} onChange={e => setSource(e.target.value)} className={`${input} max-w-xs`}>
            <option value="self">This branch's master catalog</option>
            {partners.map(p => <option key={p.partnerSlug} value={p.partnerSlug}>{p.partnerName || p.partnerSlug}</option>)}
          </select>
          <button onClick={sync} disabled={!manage || busy} className={btn()}>Sync now</button>
          {result && <span className="text-xs text-fg/80">{result.created} new, {result.updated} updated, {result.deactivated} retired, {result.unchanged} unchanged</span>}
        </div>
      </section>

      <section>
        <p className="text-fg/75 text-xs uppercase tracking-widest font-bold mb-2">Synced products and branch prices</p>
        {links.length === 0 ? <p className="text-fg/70 text-sm">Nothing synced yet.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="text-fg/70 text-xs uppercase tracking-wider text-left">
              <th className="py-2 pr-3">SKU</th><th className="py-2 pr-3">Name</th><th className="py-2 pr-3 text-right">Master</th><th className="py-2 pr-3">Branch price</th><th className="py-2 text-right">Charged</th>
            </tr></thead>
            <tbody>{links.map(l => (
              <tr key={l.sku} className={`border-t border-white/5 ${l.active ? 'text-fg' : 'text-fg/50'}`}>
                <td className="py-2 pr-3 font-mono text-xs">{l.sku}</td>
                <td className="py-2 pr-3">{l.masterName}{!l.active && ' (retired)'}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{peso(l.masterPrice)}</td>
                <td className="py-2 pr-3">
                  <input type="number" min="0" defaultValue={l.overridePrice ?? ''} placeholder="follow master" disabled={!manage}
                    onBlur={e => { if (e.target.value !== String(l.overridePrice ?? '')) override(l.sku, e.target.value); }}
                    className={`${input} max-w-[140px]`} />
                </td>
                <td className="py-2 text-right tabular-nums">{peso(l.effectivePrice)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>

      <section>
        <p className="text-fg/75 text-xs uppercase tracking-widest font-bold mb-2">Master catalog (kept on this branch)</p>
        {manage && (
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-3">
            {['sku', 'name', 'category', 'unit', 'basePrice'].map(k => (
              <input key={k} value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} placeholder={k === 'basePrice' ? 'Price' : k[0].toUpperCase() + k.slice(1)}
                type={k === 'basePrice' ? 'number' : 'text'} className={input} />
            ))}
            <button onClick={() => save({ ...form, basePrice: Number(form.basePrice) })} disabled={busy || !form.sku.trim() || !form.name.trim() || form.basePrice === ''} className={btn()}>Save</button>
          </div>
        )}
        {items.length === 0 ? <p className="text-fg/70 text-sm">No master catalog on this branch.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <tbody>{items.map(it => (
              <tr key={it.sku} className={`border-t border-white/5 ${it.active ? 'text-fg' : 'text-fg/50'}`}>
                <td className="py-2 pr-3 font-mono text-xs">{it.sku}</td>
                <td className="py-2 pr-3">{it.name}</td>
                <td className="py-2 pr-3 text-fg/70">{it.category}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{peso(it.basePrice)}</td>
                <td className="py-2 text-right">
                  {manage && <button onClick={() => save({ ...it, active: !it.active })} disabled={busy} className={btn('ghost')}>{it.active ? 'Retire' : 'Restore'}</button>}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}
