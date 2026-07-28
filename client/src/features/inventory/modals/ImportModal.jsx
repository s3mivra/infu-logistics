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
            return (
              <div className="px-5 py-3 flex flex-wrap gap-2 border-b border-white/10 shrink-0">
                <span className="text-[10px] font-black uppercase tracking-widest bg-blue-500/20 text-blue-300 px-2.5 py-1.5 rounded">NEW · {newCount}</span>
                {batchCount > 0 && <span className="text-[10px] font-black uppercase tracking-widest bg-purple-500/20 text-purple-300 px-2.5 py-1.5 rounded">NEW BATCH · {batchCount}</span>}
                <span className="text-[10px] font-black uppercase tracking-widest bg-green-500/20 text-green-300 px-2.5 py-1.5 rounded">↑ INCREASE · {upCount}</span>
                <span className="text-[10px] font-black uppercase tracking-widest bg-red-500/20 text-red-300 px-2.5 py-1.5 rounded">↓ DECREASE · {downCount}</span>
                <span className="text-[10px] font-black uppercase tracking-widest bg-white/5 text-fg/40 px-2.5 py-1.5 rounded">UNCHANGED · {sameCount}</span>
                {errCount > 0 && <span className="text-[10px] font-black uppercase tracking-widest bg-red-500/40 text-red-200 px-2.5 py-1.5 rounded">ERRORS · {errCount}</span>}
              </div>
            );
          })()}

          <div className="flex-1 overflow-y-auto custom-scrollbar">
            <table className="w-full text-xs">
              <thead className="bg-white/5 sticky top-0">
                <tr className="text-fg/40 text-[10px] uppercase tracking-widest">
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
                  return (
                    <tr key={i} className={`border-b border-white/5 ${isErr ? 'bg-red-500/10' : isBatch ? 'bg-purple-500/5' : ''}`}>
                      <td className="px-4 py-2.5 text-fg font-bold">
                        {r.itemCode && <span className="text-fg/30 font-mono text-[10px] mr-1.5">{r.itemCode}</span>}
                        {r.itemName || <span className="text-red-300">(missing)</span>}
                        {r._needsSize && (
                          <span title="No unit/size found in the name or a Unit column - imported as pcs. Edit the item afterward to set its real size." className="ml-1.5 text-[9px] font-black bg-amber-500/20 text-amber-400 border border-amber-500/40 px-1.5 py-0.5 rounded uppercase align-middle">SET SIZE</span>
                        )}
                        {isBatch && r.expiryDate && <span className="ml-1.5 text-purple-300/60 text-[10px]">exp {r.expiryDate}</span>}
                      </td>
                      <td className="px-2 py-2.5">
                        {isErr && <span className="text-[10px] font-black bg-red-500/30 text-red-200 px-1.5 py-0.5 rounded uppercase">{r._error}</span>}
                        {!isErr && isNew && <span className="text-[10px] font-black bg-blue-500/30 text-blue-200 px-1.5 py-0.5 rounded uppercase">NEW</span>}
                        {!isErr && isBatch && <span className="text-[10px] font-black bg-purple-500/30 text-purple-200 px-1.5 py-0.5 rounded uppercase">NEW BATCH</span>}
                        {!isErr && !isNew && !isBatch && diff > 0 && <span className="text-[10px] font-black bg-green-500/30 text-green-200 px-1.5 py-0.5 rounded uppercase">↑ INC</span>}
                        {!isErr && !isNew && !isBatch && diff < 0 && <span className="text-[10px] font-black bg-red-500/30 text-red-200 px-1.5 py-0.5 rounded uppercase">↓ DEC</span>}
                        {!isErr && !isNew && !isBatch && diff === 0 && <span className="text-[10px] font-black bg-white/10 text-fg/40 px-1.5 py-0.5 rounded uppercase">SAME</span>}
                      </td>
                      <td className="px-2 py-2.5 text-right text-fg/60 tabular-nums">{isNew || isErr ? '-' : `${r._oldDisplay.qty.toLocaleString(undefined, { maximumFractionDigits: 3 })} ${r._oldDisplay.unit}`}</td>
                      <td className="px-2 py-2.5 text-right text-fg font-bold tabular-nums">{isErr ? '-' : `${Number(r.qty).toLocaleString(undefined, { maximumFractionDigits: 3 })} ${r.displayUnit}`}</td>
                      <td className={`px-2 py-2.5 text-right tabular-nums font-bold ${diff > 0 ? 'text-green-400' : diff < 0 ? 'text-red-400' : 'text-fg/40'}`}>
                        {isErr || isNew ? '-' : (diff > 0 ? '+' : '') + diff.toLocaleString(undefined, { maximumFractionDigits: 3 })}
                      </td>
                      <td className="px-2 py-2.5 text-right text-fg/70 tabular-nums">{isErr || r.unitCost === '' ? '-' : peso(r.unitCost)}</td>
                      <td className={`px-4 py-2.5 text-right tabular-nums font-bold ${valueDiff > 0 ? 'text-green-400' : valueDiff < 0 ? 'text-red-400' : 'text-fg/40'}`}>{isErr ? '-' : peso(Math.abs(valueDiff)) + (valueDiff < 0 ? ' loss' : valueDiff > 0 ? ' gain' : '')}</td>
                    </tr>
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
              const body = importRows.map(r => {
                const isErr = !!r._error;
                const isNew = r._newItem;
                const isBatch = !isNew && !!r._newBatch;
                const diff = Number(r._diff || 0);
                const status = isErr ? r._error : isNew ? 'NEW' : isBatch ? 'NEW BATCH' : diff > 0 ? '↑ INC' : diff < 0 ? '↓ DEC' : 'SAME';
                const current = isNew || isErr ? '-' : `${r._oldDisplay.qty.toLocaleString(undefined, { maximumFractionDigits: 3 })} ${r._oldDisplay.unit}`;
                const next = isErr ? '-' : `${Number(r.qty).toLocaleString(undefined, { maximumFractionDigits: 3 })} ${r.displayUnit}`;
                const delta = isErr || isNew ? '-' : (diff > 0 ? '+' : '') + diff.toLocaleString(undefined, { maximumFractionDigits: 3 });
                const cost = isErr || r.unitCost === '' ? '-' : `P${Number(r.unitCost).toFixed(2)}`;
                return [r.itemCode || '-', r.itemName || '(missing)', status, current, next, delta, cost];
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
              className="flex-1 px-5 py-3 rounded-xl bg-brand hover:bg-brand-dark text-fg font-black text-sm uppercase tracking-widest transition shadow-elev-2 disabled:opacity-50 min-h-[44px] flex items-center justify-center gap-2">
              <Check size={16}/> {importSubmitting ? 'Importing…' : 'Confirm Import'}
            </button>
          </div>
        </div>
      </div>
  );
}
