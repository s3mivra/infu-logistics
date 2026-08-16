import { useState } from 'react';

// #8 - multi-location stock transfers. Request a move between two inventory items
// (each tagged to a location), route it through approve → release, and see on-hand
// value grouped by location. Quantity is entered in the source item's base unit.
export default function StockTransferPanel({
  inventory = [], stockTransfers = [], locationAnalytics = [],
  requestStockTransfer, actOnStockTransfer, isSuperAdmin, peso,
}) {
  const [fromItemId, setFromItemId] = useState('');
  const [toItemId, setToItemId] = useState('');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const fromItem = inventory.find(i => i._id === fromItemId);

  const submit = async () => {
    if (!fromItemId || !toItemId || !(parseFloat(qty) > 0) || busy) return;
    setBusy(true);
    const ok = await requestStockTransfer({ fromItemId, toItemId, qtyBase: parseFloat(qty), note: note.trim() });
    setBusy(false);
    if (ok) { setQty(''); setNote(''); }
  };

  const card = 'bg-card-bg border border-white/10 rounded-xl p-4';
  const input = 'w-full bg-page-bg border border-white/10 rounded p-2 text-fg text-sm outline-none focus:border-accent';
  const statusColor = {
    Requested: 'bg-yellow-500/15 text-yellow-400',
    Approved: 'bg-blue-500/15 text-blue-400',
    Released: 'bg-green-500/15 text-green-500',
    Rejected: 'bg-red-500/15 text-red-400',
    Cancelled: 'bg-white/10 text-fg/40',
  };
  const label = (i) => `${i.itemName}${i.stockLocation ? ` · ${i.stockLocation}` : ''}`;

  return (
    <div className="space-y-4">
      {/* By-location analytics */}
      {locationAnalytics.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {locationAnalytics.map(l => (
            <div key={l.location} className={card}>
              <p className="text-[10px] uppercase tracking-widest text-fg/40 font-bold truncate">{l.location}</p>
              <p className="text-lg font-black text-fg tabular-nums">{peso ? peso(l.totalValue) : l.totalValue}</p>
              <p className="text-[10px] text-fg/50">{l.itemCount} item(s){l.lowStockCount > 0 && <span className="text-red-400"> · {l.lowStockCount} low</span>}</p>
            </div>
          ))}
        </div>
      )}

      {/* New transfer request */}
      <div className={card}>
        <h3 className="text-fg font-black uppercase tracking-wider text-sm mb-3">New Transfer Request</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2">
          <div>
            <label className="text-[10px] text-fg/40 uppercase font-bold block mb-1">From (source)</label>
            <select value={fromItemId} onChange={e => setFromItemId(e.target.value)} className={input}>
              <option value="">- Select item -</option>
              {inventory.map(i => <option key={i._id} value={i._id}>{label(i)} ({i.stockQty} {i.unit})</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-fg/40 uppercase font-bold block mb-1">To (destination)</label>
            <select value={toItemId} onChange={e => setToItemId(e.target.value)} className={input}>
              <option value="">- Select item -</option>
              {inventory.filter(i => i._id !== fromItemId).map(i => <option key={i._id} value={i._id}>{label(i)}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-3">
          <div>
            <label className="text-[10px] text-fg/40 uppercase font-bold block mb-1">Quantity{fromItem ? ` (${fromItem.unit})` : ''}</label>
            <input type="number" min="0" value={qty} onChange={e => setQty(e.target.value)} placeholder="Base units" className={input} />
          </div>
          <div>
            <label className="text-[10px] text-fg/40 uppercase font-bold block mb-1">Note (optional)</label>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="Reason / reference" className={input} />
          </div>
        </div>
        <button onClick={submit} disabled={busy || !fromItemId || !toItemId || !(parseFloat(qty) > 0)} className="bg-accent text-white px-5 py-2.5 rounded-lg font-bold text-xs uppercase tracking-wider disabled:opacity-40 min-h-[44px]">Request Transfer</button>
      </div>

      {/* Transfer list */}
      <div className={card}>
        <h3 className="text-fg font-black uppercase tracking-wider text-sm mb-3">Transfers</h3>
        {stockTransfers.length === 0 ? (
          <p className="text-fg/40 text-xs py-6 text-center uppercase tracking-widest">No transfers yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-fg/40 text-[10px] uppercase tracking-widest border-b border-white/10">
                  <th className="text-left py-2">Ref</th>
                  <th className="text-left py-2">Item</th>
                  <th className="text-left py-2">Route</th>
                  <th className="text-right py-2">Qty</th>
                  <th className="text-left py-2 pl-3">Status</th>
                  <th className="text-right py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {stockTransfers.map(t => (
                  <tr key={t._id} className="border-b border-white/5">
                    <td className="py-2 text-fg/60 text-xs font-mono">{t.reference}</td>
                    <td className="py-2 text-fg font-bold">{t.itemName}</td>
                    <td className="py-2 text-fg/60 text-xs">{t.fromLocation || '?'} → {t.toLocation || '?'}</td>
                    <td className="py-2 text-right text-fg tabular-nums font-bold">{t.qtyBase} {t.unit}</td>
                    <td className="py-2 pl-3"><span className={`text-[10px] font-black px-2 py-1 rounded ${statusColor[t.status] || 'bg-white/10 text-fg/50'}`}>{t.status}</span></td>
                    <td className="py-2 text-right">
                      <div className="flex gap-1.5 justify-end">
                        {t.status === 'Requested' && isSuperAdmin && (
                          <button onClick={() => actOnStockTransfer(t._id, 'approve')} className="text-[10px] font-bold uppercase px-2.5 py-1.5 rounded bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 min-h-[32px]">Approve</button>
                        )}
                        {t.status === 'Approved' && (
                          <button onClick={() => actOnStockTransfer(t._id, 'release')} className="text-[10px] font-bold uppercase px-2.5 py-1.5 rounded bg-green-500/15 text-green-500 hover:bg-green-500/25 min-h-[32px]">Release</button>
                        )}
                        {['Requested', 'Approved'].includes(t.status) && (
                          <button onClick={() => actOnStockTransfer(t._id, 'reject')} className="text-[10px] font-bold uppercase px-2.5 py-1.5 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 min-h-[32px]">{isSuperAdmin ? 'Reject' : 'Cancel'}</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
