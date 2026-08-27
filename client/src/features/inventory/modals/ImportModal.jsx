import { Fragment } from 'react';
import { Check, X } from 'lucide-react';
import { useDashboard } from '../../dashboard/DashboardContext';

// Extracted from AdminDashboard; reads shared state via useDashboard().
export default function ImportModal() {
  const { BIZ_NAME, importModal, importProgress, importRows, importSubmitting, loadPdfLibs, peso, setImportModal, submitImport } = useDashboard();

  if (!(importModal)) return null;

  return (
      <div className="fixed inset-0 z-[9998] bg-black/85 flex items-end sm:items-center justify-center p-0 sm:p-4 backdrop-blur-sm animate-fade-in" onClick={e => { if (e.target === e.currentTarget) setImportModal(false); }} role="dialog" aria-modal="true" aria-label="Inventory import preview">
        <div className="bg-surface border border-white/10 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-4xl shadow-elev-3 flex flex-col max-h-[92vh] overflow-hidden animate-scale-in">
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
            <div>
              <h2 className="text-fg font-black text-lg">Bulk Import - Stock Take</h2>
              <p className="text-fg/40 text-xs font-bold uppercase tracking-widest mt-0.5">Replaces current quantities · audited via journal entries</p>
            </div>
            <button onClick={() => setImportModal(false)} className="w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 text-fg/50 flex items-center justify-center transition" aria-label="Close"><X size={16}/></button>
          </div>

          {/* Summary chips */}
          {(() => {
            const valid = importRows.filter(r => !r._error && !r._isCategory);
            const newCount = valid.filter(r => r._newItem).length;
            const batchCount = valid.filter(r => !r._newItem && r._newBatch).length;
            const upCount = valid.filter(r => !r._newItem && !r._newBatch && r._diff > 0).length;
            const downCount = valid.filter(r => !r._newItem && !r._newBatch && r._diff < 0).length;
            const sameCount = valid.filter(r => !r._newItem && !r._newBatch && r._diff === 0).length;
            const errCount = importRows.filter(r => r._error).length;
            const dateWarnRows = importRows.filter(r => r._dateFormatWarn);
            const dateFixedCount = dateWarnRows.filter(r => r._dateFormatWarn.corrected).length;
            const dateUnfixedCount = dateWarnRows.length - dateFixedCount;
            return (
              <div className="px-5 py-3 flex flex-wrap gap-2 border-b border-white/10 shrink-0">
                <span className="text-[10px] font-black uppercase tracking-widest bg-blue-500 text-white px-2.5 py-1.5 rounded">NEW · {newCount}</span>
                {batchCount > 0 && <span className="text-[10px] font-black uppercase tracking-widest bg-purple-500 text-white px-2.5 py-1.5 rounded">NEW BATCH · {batchCount}</span>}
                <span className="text-[10px] font-black uppercase tracking-widest bg-green-500 text-white px-2.5 py-1.5 rounded">↑ INCREASE · {upCount}</span>
                <span className="text-[10px] font-black uppercase tracking-widest bg-red-500 text-white px-2.5 py-1.5 rounded">↓ DECREASE · {downCount}</span>
                <span className="text-[10px] font-black uppercase tracking-widest bg-white/5 text-fg/60 px-2.5 py-1.5 rounded">UNCHANGED · {sameCount}</span>
                {errCount > 0 && <span className="text-[10px] font-black uppercase tracking-widest bg-red-500/40 text-red-200 px-2.5 py-1.5 rounded">ERRORS · {errCount}</span>}
                {dateFixedCount > 0 && <span title="These date cells were formatted day-first (d/m/yyyy) in the source file instead of MM/DD/YYYY - the date has been auto-corrected for this import. Fix the cell's format in the source file so it stops happening." className="text-[10px] font-black uppercase tracking-widest bg-amber-500 text-black px-2.5 py-1.5 rounded">✓ DATE AUTO-FIXED · {dateFixedCount}</span>}
                {dateUnfixedCount > 0 && <span title="These date cells were formatted day-first (d/m/yyyy) but couldn't be safely auto-corrected (the day value is over 12, so it can't also be a valid month). Verify these dates manually." className="text-[10px] font-black uppercase tracking-widest bg-red-500/40 text-red-200 px-2.5 py-1.5 rounded">⚠ CHECK DATE · {dateUnfixedCount}</span>}
              </div>
            );
          })()}

          <div className="flex-1 overflow-y-auto custom-scrollbar">
            <table className="w-full text-xs">
              <thead className="bg-accent sticky top-0">
                <tr className="text-white text-[10px] uppercase tracking-widest">
                  <th className="text-left px-4 py-3">Item</th>
                  <th className="text-left px-2 py-3">Status</th>
                  <th className="text-right px-2 py-3">Current</th>
                  <th className="text-right px-2 py-3">New</th>
                  <th className="text-right px-2 py-3">Δ Diff</th>
                  <th className="text-right px-2 py-3">Unit Cost</th>
                  <th className="text-right px-4 py-3">Value Δ</th>
                </tr>
              </thead>
              <tbody>
                {importRows.map((r, i) => {
                  if (r._isCategory) return (
                    <tr key={i} className="bg-white/5">
                      <td colSpan={7} className="px-4 py-2 text-fg/50 font-black text-[10px] uppercase tracking-[0.2em]">{r.category}</td>
                    </tr>
                  );
                  const isErr = !!r._error;
                  const isNew = r._newItem;
                  const isBatch = !isNew && !!r._newBatch;
                  const diff = Number(r._diff || 0);
                  const valueDiff = (isNew || isBatch ? r.qty : diff) * (r.unitCost === '' ? (r._existing?.unitCost ? r._existing.unitCost * (r._existing.unitMultiplier || 1) : 0) : Number(r.unitCost || 0));

                  // A real pack size (e.g. "…377G" parsed from the name) means the
                  // sheet's own Qty column was a PACK COUNT, not a weight - show it
                  // back in those same terms (pcs) instead of the kg/L it got
                  // converted to internally, so it reads like what was actually typed.
                  const packSize = Number(r.packSize) || 0;
                  const isPacked = packSize > 0;
                  const fmtQty = (qtyDisplay) => isPacked
                    ? `${(qtyDisplay / packSize).toLocaleString(undefined, { maximumFractionDigits: 2 })} pcs`
                    : `${qtyDisplay.toLocaleString(undefined, { maximumFractionDigits: 3 })} ${r.displayUnit}`;

                  // Multi-batch groups (repeated code/name, one row per lot) get a
                  // rolled-up TOTAL row right after the last one - Current + this
                  // row's own qty already IS the true final total, no need to
                  // manually add up every batch row by eye.
                  const key = r.itemCode || (r.itemName || '').toLowerCase();
                  const next = importRows[i + 1];
                  const prev = importRows[i - 1];
                  const nextKey = next && !next._isCategory && !next._error ? (next.itemCode || (next.itemName || '').toLowerCase()) : null;
                  const prevKey = prev && !prev._isCategory && !prev._error ? (prev.itemCode || (prev.itemName || '').toLowerCase()) : null;
                  const isLastOfGroup = key !== nextKey;
                  const wasGrouped = isBatch || key === prevKey;
                  const showTotal = !isErr && !isNew && isLastOfGroup && wasGrouped;
                  const finalTotalDisplay = showTotal ? (r._oldDisplay?.qty || 0) + Number(r.qty || 0) : 0;

                  return (
                    <Fragment key={i}>
                    <tr className={`border-b border-white/5 ${isErr ? 'bg-red-500/10' : isBatch ? 'bg-purple-500/5' : ''}`}>
                      <td className="px-4 py-2.5 text-fg font-bold">
                        {r.itemCode && <span className="text-fg/30 font-mono text-[10px] mr-1.5">{r.itemCode}</span>}
                        {r.itemName || <span className="text-red-300">(missing)</span>}
                        {r._needsSize && (
                          <span title="No unit/size found in the name or a Unit column - imported as pcs. Edit the item afterward to set its real size." className="ml-1.5 text-[9px] font-black bg-amber-500 text-white border border-amber-500/40 px-1.5 py-0.5 rounded uppercase align-middle">SET SIZE</span>
                        )}
                        {r._dateFormatWarn && r._dateFormatWarn.corrected && (
                          <span title={`This cell's Excel format is day-first (d/m/yyyy), not MM/DD/YYYY like the rest of the file - it displayed as "${r._dateFormatWarn.display}". Auto-corrected to ${r.expiryDate || r.productionDate} for this import. Fix the cell's format in the source file so this stops happening.`} className="ml-1.5 text-[9px] font-black bg-amber-500 text-black border border-amber-600/40 px-1.5 py-0.5 rounded uppercase align-middle">✓ Date auto-fixed</span>
                        )}
                        {r._dateFormatWarn && !r._dateFormatWarn.corrected && (
                          <span title={`This cell's Excel format is day-first (d/m/yyyy) and displayed as "${r._dateFormatWarn.display}" - it couldn't be safely auto-corrected (its day is over 12, so it can't also be read as a month). Verify this date manually and fix the cell's format in the source file.`} className="ml-1.5 text-[9px] font-black bg-red-500 text-white border border-red-600/40 px-1.5 py-0.5 rounded uppercase align-middle">⚠ Check date</span>
                        )}
                        {isBatch && r.expiryDate && <span className="ml-1.5 text-purple-300/60 text-[10px]">exp {r.expiryDate}</span>}
                        {isBatch && !r.expiryDate && r.productionDate && <span className="ml-1.5 text-purple-300/60 text-[10px]">prod {r.productionDate}</span>}
                      </td>
                      <td className="px-2 py-2.5">
                        {isErr && <span className="text-[10px] font-black bg-red-500 text-white px-1.5 py-0.5 rounded uppercase">{r._error}</span>}
                        {!isErr && isNew && <span className="text-[10px] font-black bg-blue-500 text-white px-1.5 py-0.5 rounded uppercase">NEW</span>}
                        {!isErr && isBatch && <span className="text-[10px] font-black bg-purple-500 text-white px-1.5 py-0.5 rounded uppercase">NEW BATCH</span>}
                        {!isErr && !isNew && !isBatch && diff > 0 && <span className="text-[10px] font-black bg-green-500 text-white px-1.5 py-0.5 rounded uppercase">↑ INC</span>}
                        {!isErr && !isNew && !isBatch && diff < 0 && <span className="text-[10px] font-black bg-red-500 text-white px-1.5 py-0.5 rounded uppercase">↓ DEC</span>}
                        {!isErr && !isNew && !isBatch && diff === 0 && <span className="text-[10px] font-black bg-white/10 text-fg/60 px-1.5 py-0.5 rounded uppercase">SAME</span>}
                      </td>
                      <td className="px-2 py-2.5 text-right text-fg/60 tabular-nums">{isNew || isErr ? '-' : fmtQty(r._oldDisplay.qty)}</td>
                      <td className="px-2 py-2.5 text-right text-fg font-bold tabular-nums">{isErr ? '-' : fmtQty(Number(r.qty))}</td>
                      <td className={`px-2 py-2.5 text-right tabular-nums font-bold ${diff > 0 ? 'text-green-400' : diff < 0 ? 'text-red-400' : 'text-fg/40'}`}>
                        {isErr || isNew ? '-' : (diff > 0 ? '+' : '') + (isPacked ? (diff / packSize).toLocaleString(undefined, { maximumFractionDigits: 2 }) : diff.toLocaleString(undefined, { maximumFractionDigits: 3 }))}
                      </td>
                      <td className="px-2 py-2.5 text-right text-fg/70 tabular-nums">{isErr || r.unitCost === '' ? '-' : peso(r.unitCost)}</td>
                      <td className={`px-4 py-2.5 text-right tabular-nums font-bold ${valueDiff > 0 ? 'text-green-400' : valueDiff < 0 ? 'text-red-400' : 'text-fg/40'}`}>{isErr ? '-' : peso(Math.abs(valueDiff)) + (valueDiff < 0 ? ' loss' : valueDiff > 0 ? ' gain' : '')}</td>
                    </tr>
                    {showTotal && (
                      <tr className="border-b border-white/10 bg-brand/10">
                        <td colSpan={3} className="px-4 py-2 text-fg/60 font-black text-[10px] uppercase tracking-widest text-right">Total after import</td>
                        <td className="px-2 py-2 text-right text-brand font-black tabular-nums">{fmtQty(finalTotalDisplay)}</td>
                        <td colSpan={3}></td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Progress bar */}
          {importProgress >= 0 && (
            <div className="px-5 pt-3 shrink-0">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-black uppercase tracking-widest text-fg/50">
                  {importProgress < 100 ? 'Processing…' : 'Done!'}
                </span>
                <span className="text-[10px] font-mono text-fg/50">{importProgress}%</span>
              </div>
              <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-150 ${importProgress === 100 ? 'bg-green-400' : 'bg-brand'}`}
                  style={{ width: `${importProgress}%` }}
                />
              </div>
            </div>
          )}

          <div className="px-5 py-4 border-t border-white/10 flex items-center gap-3 shrink-0">
            <button onClick={() => setImportModal(false)} disabled={importSubmitting} className="flex-1 sm:flex-initial px-5 py-3 rounded-xl bg-white/5 hover:bg-white/10 text-fg/60 hover:text-fg font-bold text-xs uppercase tracking-wider transition min-h-[44px] disabled:opacity-40 disabled:pointer-events-none">
              Cancel
            </button>
            <button onClick={async () => {
              const { jsPDF, autoTable } = await loadPdfLibs();
              const doc = new jsPDF('landscape');
              doc.setFontSize(16); doc.text(`${BIZ_NAME} - Bulk Import Preview`, 14, 14);
              doc.setFontSize(9); doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 21);
              const body = [];
              importRows.forEach((r, i) => {
                const isErr = !!r._error;
                const isNew = r._newItem;
                const isBatch = !isNew && !!r._newBatch;
                const diff = Number(r._diff || 0);
                const status = isErr ? r._error : isNew ? 'NEW' : isBatch ? 'NEW BATCH' : diff > 0 ? '↑ INC' : diff < 0 ? '↓ DEC' : 'SAME';
                // Same pack-count convention as the on-screen preview: a real pack
                // size means the sheet's Qty column was a count, not a weight.
                const packSize = Number(r.packSize) || 0;
                const isPacked = packSize > 0;
                const fmtQty = (qtyDisplay) => isPacked
                  ? `${(qtyDisplay / packSize).toLocaleString(undefined, { maximumFractionDigits: 2 })} pcs`
                  : `${qtyDisplay.toLocaleString(undefined, { maximumFractionDigits: 3 })} ${r.displayUnit}`;
                const current = isNew || isErr ? '-' : fmtQty(r._oldDisplay.qty);
                const next = isErr ? '-' : fmtQty(Number(r.qty));
                const delta = isErr || isNew ? '-' : (diff > 0 ? '+' : '') + (isPacked ? (diff / packSize).toLocaleString(undefined, { maximumFractionDigits: 2 }) : diff.toLocaleString(undefined, { maximumFractionDigits: 3 }));
                const cost = isErr || r.unitCost === '' ? '-' : `P${Number(r.unitCost).toFixed(2)}`;
                body.push([r.itemCode || '-', r.itemName || '(missing)', status, current, next, delta, cost]);

                const key = r.itemCode || (r.itemName || '').toLowerCase();
                const next2 = importRows[i + 1];
                const prev2 = importRows[i - 1];
                const nextKey = next2 && !next2._isCategory && !next2._error ? (next2.itemCode || (next2.itemName || '').toLowerCase()) : null;
                const prevKey = prev2 && !prev2._isCategory && !prev2._error ? (prev2.itemCode || (prev2.itemName || '').toLowerCase()) : null;
                const isLastOfGroup = key !== nextKey;
                const wasGrouped = isBatch || key === prevKey;
                if (!isErr && !isNew && isLastOfGroup && wasGrouped) {
                  const finalTotal = (r._oldDisplay?.qty || 0) + Number(r.qty || 0);
                  body.push(['', '', '', '', `TOTAL: ${fmtQty(finalTotal)}`, '', '']);
                }
              });
              autoTable(doc, {
                startY: 26,
                head: [['Code', 'Item Name', 'Status', 'Current', 'New Qty', 'Δ Diff', 'Unit Cost']],
                body,
                theme: 'grid',
                headStyles: { fillColor: [40, 40, 40] },
                styles: { fontSize: 8 },
                columnStyles: { 0: { cellWidth: 22 }, 2: { halign: 'center' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
              });
              doc.save(`import-preview-${new Date().toISOString().slice(0,10)}.pdf`);
            }} className="px-5 py-3 rounded-xl bg-white/5 hover:bg-white/10 text-fg/60 hover:text-fg font-bold text-xs uppercase tracking-wider transition min-h-[44px]">
              Export PDF
            </button>
            <button onClick={submitImport} disabled={importSubmitting || importRows.every(r => r._error)}
              className="flex-1 px-5 py-3 rounded-xl bg-brand hover:bg-brand-dark text-white font-black text-sm uppercase tracking-widest transition shadow-elev-2 disabled:opacity-50 min-h-[44px] flex items-center justify-center gap-2">
              <Check size={16}/> {importSubmitting ? 'Importing…' : 'Confirm Import'}
            </button>
          </div>
        </div>
      </div>
  );
}
