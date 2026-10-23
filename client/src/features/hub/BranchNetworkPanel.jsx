import { useState, useEffect, useCallback } from 'react';
import { BarChart3, Truck, BookOpen, RefreshCw, Plus, Trash2, AlertTriangle } from 'lucide-react';
import { todayStr } from '../../shared/businessDay.js';

// Multi-branch tools on the Hub: consolidated reports, branch-to-branch stock
// transfers (request -> approve -> ship -> receive) and the shared catalog.
// Server side: server/features/branch-network.js.

const statusTone = {
  Requested: 'bg-orange-500/15 text-warning',
  Approved: 'bg-blue-500/15 text-info',
  Shipped: 'bg-yellow-500/15 text-warning',
  Received: 'bg-green-500/15 text-success',
  Rejected: 'bg-red-500/15 text-danger',
  Cancelled: 'bg-white/10 text-fg/70',
};

export default function BranchNetworkPanel({ authFetch, partners = [], inventory = [], peso = (n) => Number(n || 0).toFixed(2), isSuperAdmin, can = () => true, fetchERPData, card, input, btn }) {
  const [view, setView] = useState('reports');
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

  const tabs = [
    ...(isSuperAdmin ? [['reports', 'Consolidated', BarChart3]] : []),
    ['transfers', 'Branch Transfers', Truck],
    ['catalog', 'Shared Catalog', BookOpen],
  ];
  useEffect(() => { if (!isSuperAdmin && view === 'reports') setView('transfers'); }, [isSuperAdmin, view]);

  return (
    <div className={card}>
      <h3 className="text-fg font-black uppercase tracking-wider text-sm mb-3">Multi-Branch</h3>
      <div className="flex flex-wrap gap-2 mb-4">
        {tabs.map(([id, label, Icon]) => (
          <button key={id} onClick={() => setView(id)}
            className={`px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 min-h-[40px] ${view === id ? 'bg-accent text-on-brand' : 'border border-white/15 text-fg hover:bg-white/5'}`}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>
      {err && <p className="text-danger text-sm mb-3">{err}</p>}
      {msg && <p className="text-warning text-sm mb-3">{msg}</p>}
      {view === 'reports' && isSuperAdmin && <Reports call={call} setErr={setErr} peso={peso} input={input} btn={btn} />}
      {view === 'transfers' && <Transfers call={call} setErr={setErr} partners={active} inventory={inventory} peso={peso} isSuperAdmin={isSuperAdmin} can={can} fetchERPData={fetchERPData} input={input} btn={btn} />}
      {view === 'catalog' && <Catalog call={call} setErr={setErr} partners={active} peso={peso} can={can} input={input} btn={btn} />}
    </div>
  );
}

function Reports({ call, setErr, peso, input, btn }) {
  const [start, setStart] = useState(() => `${todayStr().slice(0, 8)}01`);
  const [end, setEnd] = useState(() => todayStr());
  const [rep, setRep] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    try { setRep(await call(`/api/hub/consolidated-report?start=${start}&end=${end}`)); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };
  const cols = [
    ['Sales', b => peso(b.sales?.revenue)], ['Orders', b => b.sales?.orders ?? 0],
    ['Net revenue', b => peso(b.pnl?.netRevenue)], ['Gross profit', b => peso(b.pnl?.grossProfit)],
    ['Net income', b => peso(b.pnl?.netIncome)], ['Stock value', b => peso(b.stock?.value)],
  ];
  return (
    <div>
      <div className="flex flex-wrap items-end gap-2 mb-3">
        <label className="text-xs text-fg/70">From<input type="date" value={start} onChange={e => setStart(e.target.value)} className={input} /></label>
        <label className="text-xs text-fg/70">To<input type="date" value={end} onChange={e => setEnd(e.target.value)} className={input} /></label>
        <button onClick={load} disabled={busy} className={btn()}>{busy ? 'Building…' : 'Build report'}</button>
      </div>
      {rep && (
        <>
          {!rep.complete && (
            <p className="text-warning text-sm mb-3 flex items-center gap-1.5">
              <AlertTriangle size={14} /> Incomplete - could not reach {rep.unreachable.map(u => u.name).join(', ')}. Totals cover the branches listed below only.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-fg/70 text-xs uppercase tracking-wider text-left">
                <th className="py-2 pr-3">Branch</th>{cols.map(([h]) => <th key={h} className="py-2 pr-3 text-right">{h}</th>)}<th className="py-2 text-right">Sales share</th>
              </tr></thead>
              <tbody>
                {rep.branches.map(b => (
                  <tr key={b.slug} className="border-t border-white/5 text-fg">
                    <td className="py-2 pr-3">{b.name}{b.branchCode && <span className="text-fg/60 text-xs ml-1">{b.branchCode}</span>}</td>
                    {cols.map(([h, f]) => <td key={h} className="py-2 pr-3 text-right tabular-nums">{f(b)}</td>)}
                    <td className="py-2 text-right tabular-nums">{b.share?.revenue ?? 0}%</td>
                  </tr>
                ))}
                <tr className="border-t border-white/20 font-bold text-fg">
                  <td className="py-2 pr-3">Total</td>
                  {cols.map(([h, f]) => <td key={h} className="py-2 pr-3 text-right tabular-nums">{f(rep.totals)}</td>)}
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Transfers({ call, setErr, partners, inventory, peso, isSuperAdmin, can, fetchERPData, input, btn }) {
  const [rows, setRows] = useState([]);
  const [self, setSelf] = useState('');
  const [partner, setPartner] = useState('');
  const [direction, setDirection] = useState('send');
  const [lines, setLines] = useState([{ itemId: '', itemName: '', qty: '' }]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const manage = can('inventory.manage');

  const load = useCallback(async () => {
    try { const d = await call('/api/hub/branch-transfers'); setRows(d.transfers || []); setSelf(d.self); }
    catch (e) { setErr(e.message); }
  }, [call, setErr]);
  useEffect(() => { load(); }, [load]);

  const file = async () => {
    setBusy('new');
    try {
      const items = lines.filter(l => Number(l.qty) > 0).map(l => {
        const inv = inventory.find(i => i._id === l.itemId);
        return direction === 'send' ? { itemId: l.itemId, qty: Number(l.qty) }
          : { itemId: l.itemId || undefined, itemName: inv?.itemName || l.itemName, itemCode: inv?.itemCode, unit: inv?.unit, qty: Number(l.qty) };
      });
      await call('/api/hub/branch-transfers', { method: 'POST', body: JSON.stringify({ partnerSlug: partner, direction, items, note }) });
      setLines([{ itemId: '', itemName: '', qty: '' }]); setNote('');
      await load();
    } catch (e) { setErr(e.message); }
    finally { setBusy(''); }
  };
  const act = async (t, action) => {
    let body = {};
    if (action === 'reject' || action === 'cancel') {
      const reason = window.prompt(`Reason to ${action} ${t.transferRef} (optional)`);
      if (reason === null) return;
      body = { reason };
    }
    setBusy(t.transferRef + action);
    try {
      await call(`/api/hub/branch-transfers/${t.transferRef}/${action}`, { method: 'POST', body: JSON.stringify(body) });
      await load();
      if (action === 'ship' || action === 'receive') fetchERPData?.();
    } catch (e) { setErr(e.message); }
    finally { setBusy(''); }
  };

  const actions = (t) => {
    const a = [];
    const open = ['Requested', 'Approved'].includes(t.status);
    if (t.role === 'sender' && t.status === 'Requested' && isSuperAdmin) a.push(['approve', 'Approve']);
    if (t.role === 'sender' && t.status === 'Approved' && manage) a.push(['ship', 'Ship']);
    if (t.role === 'receiver' && t.status === 'Shipped' && manage) a.push(['receive', 'Receive']);
    if (t.role === 'sender' && open && isSuperAdmin) a.push(['reject', 'Reject']);
    if (open && manage) a.push(['cancel', 'Cancel']);
    return a;
  };

  return (
    <div>
      {manage && (
        <div className="border border-white/10 rounded-lg p-3 mb-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-2">
            <select value={partner} onChange={e => setPartner(e.target.value)} className={input}>
              <option value="">Branch…</option>
              {partners.map(p => <option key={p.partnerSlug} value={p.partnerSlug}>{p.partnerName || p.partnerSlug}</option>)}
            </select>
            <select value={direction} onChange={e => setDirection(e.target.value)} className={input}>
              <option value="send">Send our stock to them</option>
              <option value="receive">Ask them to send to us</option>
            </select>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)" className={input} />
          </div>
          {lines.map((l, i) => (
            <div key={i} className="flex gap-2 mb-2">
              <select value={l.itemId} onChange={e => setLines(ls => ls.map((x, j) => j === i ? { ...x, itemId: e.target.value } : x))} className={input}>
                <option value="">{direction === 'send' ? 'Item to send…' : 'Item (from our list, or type below)…'}</option>
                {inventory.map(it => <option key={it._id} value={it._id}>{it.itemName} ({it.stockQty} {it.unit})</option>)}
              </select>
              {direction === 'receive' && !l.itemId && (
                <input value={l.itemName} onChange={e => setLines(ls => ls.map((x, j) => j === i ? { ...x, itemName: e.target.value } : x))} placeholder="Item name" className={input} />
              )}
              <input type="number" min="0" value={l.qty} onChange={e => setLines(ls => ls.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} placeholder="Qty" className={`${input} max-w-[110px]`} />
              <button onClick={() => setLines(ls => ls.length > 1 ? ls.filter((_, j) => j !== i) : ls)} className={btn('ghost')} aria-label="Remove line"><Trash2 size={14} /></button>
            </div>
          ))}
          <div className="flex gap-2">
            <button onClick={() => setLines(ls => [...ls, { itemId: '', itemName: '', qty: '' }])} className={btn('ghost')}><Plus size={14} /></button>
            <button onClick={file} disabled={!partner || busy === 'new' || !lines.some(l => Number(l.qty) > 0 && (l.itemId || (direction === 'receive' && l.itemName.trim())))} className={btn()}>
              {busy === 'new' ? 'Filing…' : 'File transfer'}
            </button>
          </div>
        </div>
      )}

      <div className="flex justify-end mb-2"><button onClick={load} className={btn('ghost')}><RefreshCw size={14} /></button></div>
      {rows.length === 0 ? <p className="text-fg/70 text-sm">No branch transfers yet.</p> : (
        <div className="space-y-2">
          {rows.map(t => (
            <div key={t._id} className="border border-white/10 rounded-lg p-3">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span className="font-mono text-xs text-fg/80">{t.transferRef}</span>
                <span className={`px-2 py-0.5 rounded text-xs font-bold ${statusTone[t.status] || ''}`}>{t.status}</span>
                <span className="text-xs text-fg/70">{t.fromSlug === self ? 'This branch' : t.fromSlug} → {t.toSlug === self ? 'this branch' : t.toSlug}</span>
                {t.partnerSync && <span className="text-xs text-warning">not yet synced</span>}
                {t.totalValue > 0 && <span className="text-xs text-fg/80 ml-auto">{peso(t.totalValue)}</span>}
              </div>
              <ul className="text-sm text-fg/90 mb-2">
                {t.lines.map((l, i) => <li key={i}>{l.qty} {l.unit} {l.itemName}{l.itemCode ? ` (${l.itemCode})` : ''}</li>)}
              </ul>
              {t.reason && <p className="text-xs text-fg/70 mb-2">Reason: {t.reason}</p>}
              <div className="flex flex-wrap gap-2">
                {actions(t).map(([a, label]) => (
                  <button key={a} onClick={() => act(t, a)} disabled={!!busy} className={btn(a === 'reject' || a === 'cancel' ? 'red' : 'primary')}>
                    {busy === t.transferRef + a ? '…' : label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
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
