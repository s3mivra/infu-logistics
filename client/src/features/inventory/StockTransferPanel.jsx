import { useState, useEffect } from 'react';
import * as ui from '../../shared/ui';

import { PACK_UNIT } from '../../shared/packUnit.js';
import SearchSelect from '../../shared/ui/SearchSelect';
import PagedRows from '../../shared/PagedRows';
// #8 - multi-location stock transfers. Request a move between two inventory items
// (each tagged to a location), route it through approve → release, and see on-hand
// value grouped by location. Quantity is entered in the source item's base unit.
//
// Moves between your OWN places only. Sending stock to another business is
// Hub's job (Hub > Transfers), and receiving from one too: it used to be
// possible from both screens, which meant two places to look for a shipment.
export default function StockTransferPanel({
  inventory = [], stockTransfers = [], locationAnalytics = [],
  requestStockTransfer, actOnStockTransfer, isSuperAdmin, canApprove, peso, apiFetch,
  exportStockTransfersPDF, itemDisplay,
}) {
  const [fromItemId, setFromItemId] = useState('');
  const [toValue, setToValue] = useState(''); // the destination inventory _id
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  // '' = FEFO (oldest expiry first, the default); otherwise an ISO expiryDate
  // pinning the transfer to that one batch on the source item.
  const [expiryChoice, setExpiryChoice] = useState('');

  const fromItem = inventory.find(i => i._id === fromItemId);
  const fromBatches = (fromItem?.expiryBatches || []).filter(b => (b.qty || 0) > 0);

  // Quantities are entered in PIECES and converted to base units on the way
  // out, because that is how stock is counted everywhere else in the app. For
  // a packed item ("377G", packSize 24, ...) one piece is packBase base units;
  // for an unpacked one a piece IS the display unit, so the factor is 1 and
  // nothing changes. Guarded so an item with no descriptors can never produce
  // a 0 or NaN factor and silently transfer nothing.
  const disp = fromItem && itemDisplay ? itemDisplay(fromItem) : null;
  // One counted unit, in base units - the same factor the Hub counts with.
  // It used to be 1 for anything not counted in packs, which is right for
  // pieces and wrong for weight and volume: an item kept in grams and shown
  // in kg took "transfer 2" as two GRAMS.
  const perPiece = Number(disp?.packBase) || 1;
  const pieceLabel = disp?.isPacked ? PACK_UNIT : (disp?.unit || fromItem?.unit || 'units');
  const qtyPieces = parseFloat(qty);
  const qtyInBase = Number.isFinite(qtyPieces) ? +(qtyPieces * perPiece).toFixed(6) : 0;
  // What is actually on hand, in the same unit the user is typing in.
  const availablePieces = fromItem ? +(((fromItem.stockQty || 0) / perPiece).toFixed(4)) : 0;
  const overAvailable = !!fromItem && qtyInBase > (fromItem.stockQty || 0) + 1e-6;
  const toItemId = toValue;

  // Switching the source item invalidates any batch pinned on the old one.
  useEffect(() => { setExpiryChoice(''); }, [fromItemId]);

  const fmtExpiry = (d) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

  // Whether any business is linked through Hub - only to point there.
  const [hubLinked, setHubLinked] = useState(false);
  useEffect(() => {
    if (!apiFetch) return;
    apiFetch('/api/hub/info').then(r => r.json())
      .then(info => setHubLinked((info.links || []).some(l => l.status === 'active')))
      .catch(() => { /* no pointer then */ });
  }, [apiFetch]);

  const submit = async () => {
    if (!fromItemId || !toValue || !(qtyInBase > 0) || busy) return;
    if (overAvailable) { ui.alert(`Only ${availablePieces} ${pieceLabel} on hand.`); return; }
    setBusy(true);
    const ok = await requestStockTransfer({ fromItemId, toItemId, qtyBase: qtyInBase, note: note.trim(), expiryDate: expiryChoice || null });
    setBusy(false);
    if (ok) { setQty(''); setNote(''); setExpiryChoice(''); }
  };

  const card = 'bg-surface border border-white/10 rounded-xl p-4';
  const input = 'w-full bg-page-bg border border-white/10 rounded p-2 text-fg text-sm outline-none focus:border-accent';
  const statusColor = {
    Requested: 'bg-yellow-500/15 text-warning',
    Approved: 'bg-blue-500/15 text-info',
    Released: 'bg-green-500/15 text-success',
    Rejected: 'bg-red-500/15 text-danger',
    Cancelled: 'bg-white/10 text-fg/70',
  };
  const label = (i) => `${i.itemName}${i.stockLocation ? ` · ${i.stockLocation}` : ''}`;
  // Transfers are stored in base units (the ledger and stock cards need them
  // that way), but read back in pieces so a row matches what was typed. Falls
  // back to the raw stored figure when the item can't be resolved.
  const showQty = (t, itemId) => {
    const it = inventory.find(i => String(i._id) === String(itemId ?? t.fromItemId ?? t.itemId));
    const d = it && itemDisplay ? itemDisplay(it) : null;
    if (!d?.packBase) return `${t.qtyBase} ${t.unit || it?.unit || ''}`.trim();
    return `${+(t.qtyBase / d.packBase).toFixed(3)} ${d.isPacked ? PACK_UNIT : d.unit}`;
  };

  return (
    <div className="space-y-4">
      {/* By-location analytics */}
      {locationAnalytics.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {locationAnalytics.map(l => (
            <div key={l.location} className={card}>
              <p className="text-[10px] uppercase tracking-widest text-white font-bold truncate">{l.location}</p>
              <p className="text-lg font-black text-white tabular-nums">{peso ? peso(l.totalValue) : l.totalValue}</p>
              <p className="text-[10px] text-white/50">{l.itemCount} item(s){l.lowStockCount > 0 && <span className="text-danger"> · {l.lowStockCount} low</span>}</p>
            </div>
          ))}
        </div>
      )}

      {/* New transfer request */}
      <div className={card}>
        <h3 className="text-white font-black uppercase tracking-wider text-sm mb-1">New Transfer Request</h3>
        {/* Spell out the boundary this tab works within - the Hub tab's
            transfer moves stock to a DIFFERENT business, which is a different
            money path entirely. Users conflate the two constantly. */}
        <p className="text-fg/70 text-[11px] mb-3">
          Moves stock between locations of <span className="text-fg/70 font-bold">this</span> business - same inventory, same books.
          To ship stock to another business in your network, use the Hub tab.
          Either way the slip needs approval before stock moves.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2">
          <div>
            <label className="text-[10px] text-white uppercase font-bold block mb-1">From (source)</label>
            <SearchSelect value={fromItemId} onChange={e => setFromItemId(e.target.value)} className={input}
              placeholder="Type to find the item"
              options={inventory.map(i => {
                // On-hand in the same unit the quantity box accepts, so
                // "120 pcs available" and "transfer 5 pcs" agree. Stock is kept
                // in grams and millilitres; printing it raw beside a "kg" label
                // read 2,000 g as "2000 kg".
                const d = itemDisplay ? itemDisplay(i) : null;
                const onHand = d ? `${+d.packQty.toFixed(3)} ${d.isPacked ? PACK_UNIT : d.unit}` : `${i.stockQty} ${i.unit}`;
                return { value: i._id, label: label(i), hint: onHand };
              })} />
            {fromBatches.length > 0 && (
              <div className="mt-1.5">
                <label className="text-[10px] text-white uppercase font-bold block mb-1">Batch / Expiry</label>
                <select value={expiryChoice} onChange={e => setExpiryChoice(e.target.value)} className={input}>
                  <option value="">FEFO/FPFO - oldest first (recommended)</option>
                  {fromBatches.map((b, i) => {
                    // Goods with no real expiry (beans, etc.) rotate by production date instead.
                    const rotationDate = b.expiryDate || b.productionDate;
                    const dateLabel = b.expiryDate ? `Exp ${fmtExpiry(b.expiryDate)}` : `Prod ${fmtExpiry(b.productionDate)}`;
                    return (
                      <option key={i} value={rotationDate}>{dateLabel} - {+(b.qty / perPiece).toFixed(2)} {pieceLabel} available</option>
                    );
                  })}
                </select>
              </div>
            )}
          </div>
          <div>
            <label className="text-[10px] text-white uppercase font-bold block mb-1">To (destination)</label>
            <SearchSelect value={toValue} onChange={e => setToValue(e.target.value)} className={input}
              placeholder="Type to find the destination"
              options={[
                ...inventory.filter(i => i._id !== fromItemId).map(i => ({ value: i._id, label: label(i), group: 'My Locations' })),
              ]} />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-3">
          <div>
            <label className="text-[10px] text-white uppercase font-bold block mb-1">
              Quantity{fromItem ? ` (${pieceLabel})` : ''}
            </label>
            <input type="number" min="0" step="any" value={qty} onChange={e => setQty(e.target.value)}
              placeholder={fromItem ? `How many ${pieceLabel}` : 'Select a source item first'}
              className={`${input}${overAvailable ? ' border-red-500/60' : ''}`} />
            {fromItem && (
              <p className={`text-[10px] mt-1 ${overAvailable ? 'text-danger font-bold' : 'text-fg/70'}`}>
                {overAvailable
                  ? `Only ${availablePieces} ${pieceLabel} on hand.`
                  : <>
                      {availablePieces} {pieceLabel} on hand
                      {/* Show the base-unit figure that will actually be moved
                          when a piece is not one base unit - it is what the
                          stock card and the ledger will record. */}
                      {perPiece !== 1 && qtyInBase > 0 && ` · moves ${qtyInBase} ${fromItem.unit}`}
                    </>}
              </p>
            )}
          </div>
          <div>
            <label className="text-[10px] text-white uppercase font-bold block mb-1">Note (optional)</label>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="Reason / reference" className={input} />
          </div>
        </div>
        <button onClick={submit} disabled={busy || !fromItemId || !toValue || !(qtyInBase > 0) || overAvailable} className="bg-accent text-on-brand px-5 py-2.5 rounded-lg font-bold text-xs uppercase tracking-wider disabled:opacity-40 min-h-[44px]">
          Request Transfer
        </button>
      </div>

      {/* Transfer list */}
      <div className={card}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-white font-black uppercase tracking-wider text-sm">Transfers</h3>
          {exportStockTransfersPDF && stockTransfers.length > 0 && (
            <button onClick={exportStockTransfersPDF} className="text-[10px] bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded font-bold uppercase tracking-wider transition">Export PDF</button>
          )}
        </div>
        {stockTransfers.length === 0 ? (
          <p className="text-white text-xs py-6 text-center uppercase tracking-widest">No transfers yet - use New Transfer Request above to move stock between your places</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-white text-[10px] uppercase tracking-widest border-b border-white/10">
                  <th className="text-left py-2">Ref</th>
                  <th className="text-left py-2">Item</th>
                  <th className="text-left py-2">Route</th>
                  <th className="text-right py-2">Qty</th>
                  <th className="text-left py-2 pl-3">Status</th>
                  <th className="text-right py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                <PagedRows items={stockTransfers} label="transfers" render={t => (
                  <tr key={t._id} className="border-b border-white/5">
                    <td className="py-2 text-white text-xs font-mono">{t.reference}</td>
                    <td className="py-2 text-white font-bold">{t.itemName}</td>
                    <td className="py-2 text-white text-xs">{t.fromLocation || '?'} → {t.toLocation || '?'}</td>
                    <td className="py-2 text-right text-white tabular-nums font-bold">
                      {showQty(t)}
                      {/* t.expiryDate holds whichever rotation date the pinned batch used - a
                          real expiry, or a production date for goods with no real expiry. */}
                      {t.expiryDate && <span className="block text-[10px] font-normal text-white">batch {fmtExpiry(t.expiryDate)}</span>}
                    </td>
                    <td className="py-2 pl-3"><span className={`text-[10px] font-black px-2 py-1 rounded ${statusColor[t.status] || 'bg-white/10 text-white/50'}`}>{t.status}</span></td>
                    <td className="py-2 text-right">
                      <div className="flex gap-1.5 justify-end">
                        {t.status === 'Requested' && (canApprove ?? isSuperAdmin) && (
                          <button onClick={() => actOnStockTransfer(t._id, 'approve')} className="text-[10px] font-bold uppercase px-2.5 py-1.5 rounded bg-blue-500/15 text-info hover:bg-blue-500/25 min-h-[32px]">Approve</button>
                        )}
                        {t.status === 'Approved' && (
                          <button onClick={() => actOnStockTransfer(t._id, 'release')} className="text-[10px] font-bold uppercase px-2.5 py-1.5 rounded bg-green-500/15 text-success hover:bg-green-500/25 min-h-[32px]">Release</button>
                        )}
                        {['Requested', 'Approved'].includes(t.status) && (
                          <button onClick={() => actOnStockTransfer(t._id, 'reject')} className="text-[10px] font-bold uppercase px-2.5 py-1.5 rounded bg-red-500/10 text-danger hover:bg-red-500/20 min-h-[32px]">{isSuperAdmin ? 'Reject' : 'Cancel'}</button>
                        )}
                      </div>
                    </td>
                  </tr>
                )} />
              </tbody>
            </table>
          </div>
        )}
      </div>

      {hubLinked && (
        <p className="text-xs text-fg/70 px-1">
          Sending stock to another business, or accepting what one sent you? That is in <span className="font-bold text-fg">Hub</span>, in the sidebar.
        </p>
      )}
    </div>
  );
}
