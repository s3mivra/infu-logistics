import React from 'react';
import { Lock, Unlock, X, RefreshCw, Plus } from 'lucide-react';
import * as ui from '../../shared/ui';

import { PACK_UNIT } from '../../shared/packUnit.js';
import SearchSelect from '../../shared/ui/SearchSelect';
// Stock held for a named client - usually because they have paid a deposit on
// it. Held stock stays on the shelf and in the stock figure, but no other
// client's order can take it; the holder's own order releases the hold as it
// completes. See features/reservations.js for the rule this screen drives.
export default function ReservationsPanel({ apiFetch, inventory = [], clientAccounts = [], itemDisplay, isSuperAdmin, can }) {
  const [rows, setRows] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [defaultDays, setDefaultDays] = React.useState(30);
  const [form, setForm] = React.useState({ open: false, clientId: '', invId: '', qty: '', expiresAt: '', note: '' });
  const mayManage = isSuperAdmin || can?.('inventory.manage');

  const load = React.useCallback(async () => {
    try {
      const res = await apiFetch('/api/reservations');
      const d = await res.json();
      if (d.success) { setRows(d.reservations || []); setDefaultDays(d.defaultDays || 30); }
      else setRows([]);
    } catch { setRows([]); }
  }, [apiFetch]);

  React.useEffect(() => { load(); }, [load]);

  // Reservations are stored in base units, like stockQty. Shown in the item's
  // own display unit so the number matches what staff count on the shelf.
  const qtyLabel = (invId, qty) => {
    const item = inventory.find(i => String(i._id) === String(invId));
    if (!item) return qty;
    const shown = itemDisplay?.(item);
    const scale = (item.stockQty || 0) > 0 && shown ? shown.qty / item.stockQty : 1;
    const unit = shown?.isPacked ? PACK_UNIT : (shown?.unit || item.displayUnit || item.unit || '');
    return `${(qty * scale).toLocaleString(undefined, { maximumFractionDigits: 3 })} ${unit}`.trim();
  };

  const submit = async () => {
    if (!form.clientId) return ui.alert('Pick the client this stock is for.');
    if (!form.invId || !(Number(form.qty) > 0)) return ui.alert('Pick an item and a quantity to hold.');
    setBusy(true);
    try {
      const res = await apiFetch('/api/reservations', {
        method: 'POST',
        body: JSON.stringify({
          clientId: form.clientId,
          items: [{ invId: form.invId, qty: Number(form.qty) }],
          ...(form.expiresAt ? { expiresAt: form.expiresAt } : {}),
          note: form.note.trim(),
        }),
      });
      const d = await res.json();
      if (!d.success) return ui.alert(d.error || 'Could not hold that stock.');
      setForm({ open: false, clientId: '', invId: '', qty: '', expiresAt: '', note: '' });
      load();
      ui.alert(`${d.reservation.reservationNumber} held until ${new Date(d.reservation.expiresAt).toLocaleDateString()}.`);
    } catch { ui.alert('Network error.'); }
    finally { setBusy(false); }
  };

  // Cancelling asks why - a hold that was let go without a reason is exactly
  // the thing somebody asks about a month later.
  const [cancelling, setCancelling] = React.useState(null); // { row, reason }

  const close = async (row, kind, reason = '') => {
    setBusy(true);
    try {
      const res = await apiFetch(`/api/reservations/${row._id}/${kind}`, { method: 'POST', body: JSON.stringify({ reason }) });
      const d = await res.json();
      if (!d.success) return ui.alert(d.error || 'Could not do that.');
      setCancelling(null);
      load();
    } catch { ui.alert('Network error.'); }
    finally { setBusy(false); }
  };

  const tone = {
    Open: 'bg-amber-500/15 text-warning',
    Released: 'bg-green-500/15 text-success',
    Cancelled: 'bg-white/10 text-fg/65',
    Expired: 'bg-white/10 text-fg/65',
  };

  return (
    <div className="bg-surface border border-white/10 rounded-xl p-4 sm:p-6">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
        <div>
          <h3 className="text-fg font-black text-lg flex items-center gap-2"><Lock size={16} className="text-brand-text" /> Reserved Stock</h3>
          <p className="text-fg/65 text-xs mt-0.5 max-w-prose">
            Stock held for one client. It stays on the shelf, but nobody else&apos;s order can take it. Their own order releases the hold as it completes, and an uncollected hold expires on its own after {defaultDays} days.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 rounded-lg text-fg/65 hover:text-fg hover:bg-white/5 transition" aria-label="Refresh reservations">
            <RefreshCw size={14} />
          </button>
          {mayManage && (
            <button onClick={() => setForm(f => ({ ...f, open: !f.open }))}
              className="flex items-center gap-1.5 bg-brand text-on-brand px-3 py-2 rounded-lg text-[11px] font-black uppercase tracking-wider hover:bg-brand/90 transition">
              <Plus size={13} /> Hold stock
            </button>
          )}
        </div>
      </div>

      {form.open && mayManage && (
        <div className="mt-4 bg-page-bg border border-white/10 rounded-xl p-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="rsv-client" className="text-[10px] font-bold text-fg/70 uppercase tracking-wider block mb-1">Held for</label>
            <SearchSelect id="rsv-client" value={form.clientId} onChange={e => setForm(f => ({ ...f, clientId: e.target.value }))}
              className="w-full bg-surface border border-white/10 rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-brand"
              placeholder="Type to find a client"
              options={clientAccounts.map(c => ({ value: c._id, label: c.name || c.username, hint: c.clientCode || '' }))} />
          </div>
          <div>
            <label htmlFor="rsv-item" className="text-[10px] font-bold text-fg/70 uppercase tracking-wider block mb-1">Item</label>
            <SearchSelect id="rsv-item" value={form.invId} onChange={e => setForm(f => ({ ...f, invId: e.target.value }))}
              className="w-full bg-surface border border-white/10 rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-brand"
              placeholder="Type to find an item"
              options={inventory.map(i => ({ value: i._id, label: i.itemName, hint: `${Math.max(0, (i.stockQty || 0) - (i.reservedQty || 0))} free` }))} />
          </div>
          <div>
            <label htmlFor="rsv-qty" className="text-[10px] font-bold text-fg/70 uppercase tracking-wider block mb-1">Quantity (base units)</label>
            <input id="rsv-qty" type="number" min="0" step="any" value={form.qty}
              onChange={e => setForm(f => ({ ...f, qty: e.target.value }))}
              className="w-full bg-surface border border-white/10 rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-brand" />
          </div>
          <div>
            <label htmlFor="rsv-until" className="text-[10px] font-bold text-fg/70 uppercase tracking-wider block mb-1">Hold until</label>
            <input id="rsv-until" type="date" value={form.expiresAt}
              onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value }))}
              className="w-full bg-surface border border-white/10 rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-brand" />
            <p className="text-[10px] text-fg/65 mt-1">Leave blank for {defaultDays} days.</p>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="rsv-note" className="text-[10px] font-bold text-fg/70 uppercase tracking-wider block mb-1">Note</label>
            <input id="rsv-note" type="text" value={form.note} placeholder="e.g. Paid ₱50,000 deposit, collecting next month"
              onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
              className="w-full bg-surface border border-white/10 rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-brand" />
          </div>
          <div className="sm:col-span-2 flex justify-end gap-2">
            <button onClick={() => setForm({ open: false, clientId: '', invId: '', qty: '', expiresAt: '', note: '' })}
              className="border border-white/10 text-fg/70 px-4 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider hover:bg-white/5">Cancel</button>
            <button onClick={submit} disabled={busy}
              className="bg-brand text-on-brand px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-wider hover:bg-brand/90 disabled:opacity-50">
              {busy ? 'Holding…' : 'Hold stock'}
            </button>
          </div>
        </div>
      )}

      <div className="mt-4 overflow-x-auto">
        {rows === null ? (
          <p className="text-fg/65 text-sm">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-fg/65 text-sm">No stock is being held. Hold stock when a client commits to goods before collecting them.</p>
        ) : (
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-fg/65 border-b border-white/10">
                <th className="text-left font-bold py-2">Ref</th>
                <th className="text-left font-bold py-2">Held for</th>
                <th className="text-left font-bold py-2">Items</th>
                <th className="text-left font-bold py-2">Until</th>
                <th className="text-left font-bold py-2">Status</th>
                <th className="text-right font-bold py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r._id} className="border-b border-white/5">
                  <td className="py-2.5 pr-3">
                    <span className="text-fg font-bold tabular-nums">{r.reservationNumber}</span>
                    {r.orderNumber && <span className="block text-[10px] text-fg/65">for {r.orderNumber}</span>}
                  </td>
                  <td className="py-2.5 pr-3 text-fg/85">{r.clientName}</td>
                  <td className="py-2.5 pr-3 text-fg/75">
                    {(r.items || []).map((i, k) => (
                      <span key={k} className="block text-[12px]">{i.itemName} · {qtyLabel(i.invId, i.qty)}</span>
                    ))}
                    {r.note && <span className="block text-[10px] text-fg/65 italic mt-0.5">{r.note}</span>}
                  </td>
                  <td className="py-2.5 pr-3 text-fg/70 text-[12px] whitespace-nowrap">
                    {r.expiresAt ? new Date(r.expiresAt).toLocaleDateString() : '-'}
                  </td>
                  <td className="py-2.5 pr-3">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${tone[r.status] || 'bg-white/10 text-fg/65'}`}>{r.status}</span>
                  </td>
                  <td className="py-2.5 text-right whitespace-nowrap">
                    {r.status === 'Open' && mayManage && (
                      <span className="inline-flex gap-1">
                        <button onClick={() => close(r, 'release')} disabled={busy}
                          title="Release the hold - the stock goes back on sale"
                          className="p-1.5 rounded-md text-fg/65 hover:text-success hover:bg-green-500/10 transition">
                          <Unlock size={14} />
                        </button>
                        <button onClick={() => setCancelling({ row: r, reason: '' })} disabled={busy}
                          title="Cancel the hold (a reason is required)"
                          className="p-1.5 rounded-md text-fg/65 hover:text-danger hover:bg-red-500/10 transition">
                          <X size={14} />
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {cancelling && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => !busy && setCancelling(null)}>
          <div role="dialog" aria-modal="true" aria-labelledby="rsv-cancel-title"
            className="bg-sidebar-bg border border-white/10 rounded-2xl shadow-2xl w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <h4 id="rsv-cancel-title" className="font-black text-fg">Cancel {cancelling.row.reservationNumber}</h4>
            <p className="text-xs text-fg/70 mt-1 mb-3">
              The stock goes straight back on sale. {cancelling.row.clientName} is not told automatically.
            </p>
            <label htmlFor="rsv-cancel-reason" className="text-[10px] font-bold text-fg/70 uppercase tracking-wider block mb-1">Reason *</label>
            <input id="rsv-cancel-reason" type="text" value={cancelling.reason} autoFocus
              onChange={e => setCancelling(c => ({ ...c, reason: e.target.value }))}
              placeholder="e.g. Client backed out"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-brand mb-3" />
            <div className="flex gap-2">
              <button onClick={() => setCancelling(null)} disabled={busy}
                className="flex-1 border border-white/10 text-fg/80 py-2.5 rounded-lg text-xs font-bold uppercase tracking-widest hover:bg-white/5">Keep it</button>
              <button onClick={() => close(cancelling.row, 'cancel', cancelling.reason.trim())} disabled={busy || !cancelling.reason.trim()}
                className="flex-1 bg-red-500/90 text-white py-2.5 rounded-lg text-xs font-black uppercase tracking-widest hover:bg-red-500 disabled:opacity-50">
                {busy ? 'Cancelling…' : 'Cancel hold'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
