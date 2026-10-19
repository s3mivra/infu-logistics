import { Download, RefreshCw, ShieldCheck } from 'lucide-react';
import TemplatesCard from './TemplatesCard';
import RangePresets from '../../shared/RangePresets';

// Export everything.
// Moved out of LedgerTab.jsx as it was; it reads everything it needs from its props.
export default function ExportAllTab({
  ledgerSubTab, exportDatasets, exportPicked, EXPORT_REPORTS, setExportPicked, apiFetch, can, isSuperAdmin,
  BUSINESS_TYPE, parseImportFile, fetchSuppliers, fetchBills, fetchExpenses, fetchERPData, downloadFullBackup, backupBusy,
  restoreFullBackup, backupProgress, exportAllBusy, exportAllRange, setExportAllRange, exportProgress, renderProgress, downloadAllExports,
}) {
  return (
    <>
    {ledgerSubTab === 'exportall' && (() => {
      const dsList = exportDatasets || [];
      const dsOn = (k) => exportPicked.ds[k] !== false;
      const repOn = (k) => exportPicked.rep[k] !== false;
      const pickedDs = dsList.filter(d => dsOn(d.key)).map(d => d.key);
      const pickedRep = EXPORT_REPORTS.filter(r => repOn(r.key)).map(r => r.key);
      // A date range only matters if something picked actually uses it.
      const needsRange = pickedRep.some(k => k === 'journal' || k === 'auditlog')
        || dsList.some(d => dsOn(d.key) && d.dateFiltered);
      const nothing = pickedDs.length === 0 && pickedRep.length === 0;
      const count = pickedDs.length + pickedRep.length;
      const preset = (dsVal, repVal) => setExportPicked({
        ds: Object.fromEntries(dsList.map(d => [d.key, dsVal])),
        rep: Object.fromEntries(EXPORT_REPORTS.map(r => [r.key, repVal])),
      });
      const setGroup = (group, val) => setExportPicked(prev => ({
        ...prev,
        [group]: Object.fromEntries((group === 'ds' ? dsList : EXPORT_REPORTS).map(x => [x.key, val])),
      }));
      const toggle = (group, key) => setExportPicked(prev => ({
        ...prev, [group]: { ...prev[group], [key]: prev[group][key] === false },
      }));
      const chip = (on) => `flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-lg border cursor-pointer transition min-w-0 ${
        on ? 'border-brand/60 bg-brand/10 text-fg' : 'border-white/10 text-fg/70 hover:text-fg hover:bg-white/5'}`;
      const presetBtn = 'text-[10px] font-black uppercase tracking-widest px-3 py-2 rounded-lg border border-white/15 text-fg/70 hover:text-fg hover:bg-white/5 transition disabled:opacity-40';
      return (
      <div className="space-y-4">

      {/* Every import template in one workbook, and that workbook back in. */}
      <TemplatesCard apiFetch={apiFetch} can={can} isSuperAdmin={isSuperAdmin} businessType={BUSINESS_TYPE}
        parseImportFile={parseImportFile}
        onImported={() => { fetchSuppliers?.(); fetchBills?.(); fetchExpenses?.(); fetchERPData?.(); }} />

      {/* The export below is a set of REPORTS - chosen columns, derived
          figures, for a person or an accountant to read. It cannot rebuild
          the system. The backup here is the other thing: every record, in
          one file, and the only export that can be restored. */}
      <div className="bg-surface border border-white/10 rounded-2xl p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h3 className="text-xl font-black text-fg flex items-center gap-2"><ShieldCheck size={18} className="text-brand-text"/> Full backup</h3>
            <p className="text-fg/70 text-xs mt-1 max-w-prose leading-snug">
              Every record in the system - orders, ledger, stock, clients, settings, users, counters - in one workbook.
              This is the file to keep: it is the only export that can be restored after data is purged or lost.
              The report exports below are for reading, not for rebuilding.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={downloadFullBackup} disabled={!!backupBusy}
              className="flex items-center gap-2 bg-brand text-on-brand px-4 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-brand/90 transition disabled:opacity-50">
              <Download size={14} /> {backupBusy ? backupBusy : 'Download backup'}
            </button>
            <label className={`flex items-center gap-2 border border-white/15 text-fg/80 px-4 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest transition ${backupBusy ? 'opacity-50' : 'cursor-pointer hover:bg-white/5 hover:text-fg'}`}>
              <RefreshCw size={14} /> Restore backup
              <input type="file" accept=".xlsx" className="hidden" disabled={!!backupBusy}
                onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; restoreFullBackup?.(f); }} />
            </label>
          </div>
        </div>
        {backupBusy && (
          <div className="mt-4" role="status" aria-live="polite">
            <div className="flex items-center justify-between gap-3 text-[11px] font-bold text-fg/80 mb-1.5">
              <span className="truncate">{backupBusy}</span>
              {backupProgress?.total > 0 && (
                <span className="tabular-nums shrink-0 text-fg/65">
                  {backupProgress.done.toLocaleString()} / {backupProgress.total.toLocaleString()}
                </span>
              )}
            </div>
            <div className="h-2 rounded-full bg-white/10 overflow-hidden">
              {/* A known total gives a real bar; before the count comes
                  back there is nothing honest to measure, so it paces
                  instead of claiming progress it cannot know. */}
              <div
                className={`h-full bg-brand transition-[width] duration-300 ${backupProgress?.total > 0 ? '' : 'animate-pulse w-1/3'}`}
                style={backupProgress?.total > 0
                  ? { width: `${Math.min(100, Math.round((backupProgress.done / backupProgress.total) * 100))}%` }
                  : undefined}
              />
            </div>
          </div>
        )}

        <p className="text-[11px] text-warning mt-3 leading-snug">
          Restoring replaces everything currently in this system with what is in the file. Take a backup first if there is anything here worth keeping.
        </p>
      </div>

      <div className="bg-surface border border-white/10 rounded-2xl p-6 space-y-6">
        <div>
          <h3 className="text-xl font-black text-fg flex items-center gap-2"><Download size={18} className="text-brand-text"/> Export</h3>
          <p className="text-fg/70 text-xs font-bold uppercase tracking-widest mt-1">Pick datasets, reports, or both</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button onClick={() => preset(true, true)} disabled={!!exportAllBusy} className={presetBtn}>Everything</button>
          <button onClick={() => preset(true, false)} disabled={!!exportAllBusy} className={presetBtn}>Datasets only</button>
          <button onClick={() => preset(false, true)} disabled={!!exportAllBusy} className={presetBtn}>Reports only</button>
          <button onClick={() => preset(false, false)} disabled={!!exportAllBusy} className={presetBtn}>Clear</button>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="bg-page-bg border border-white/10 rounded-xl p-4 min-w-0">
            <div className="flex items-center justify-between gap-2 mb-3">
              <p className="text-[10px] uppercase tracking-widest text-fg/70 font-bold">Datasets ({pickedDs.length} of {dsList.length})</p>
              <div className="flex gap-3 text-[10px] font-bold uppercase tracking-widest">
                <button onClick={() => setGroup('ds', true)} className="text-brand-text hover:underline">All</button>
                <button onClick={() => setGroup('ds', false)} className="text-fg/70 hover:text-fg">None</button>
              </div>
            </div>
            {exportDatasets === null ? (
              <p className="text-sm text-fg/70 italic">Loading datasets...</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {dsList.map(d => (
                  <label key={d.key} className={chip(dsOn(d.key))}>
                    <input type="checkbox" checked={dsOn(d.key)} onChange={() => toggle('ds', d.key)} />
                    <span className="truncate">{d.label}</span>
                    {d.dateFiltered && <span className="ml-auto text-[9px] uppercase tracking-widest text-fg/70 shrink-0">dated</span>}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="bg-page-bg border border-white/10 rounded-xl p-4 min-w-0">
            <div className="flex items-center justify-between gap-2 mb-3">
              <p className="text-[10px] uppercase tracking-widest text-fg/70 font-bold">Reports ({pickedRep.length} of {EXPORT_REPORTS.length})</p>
              <div className="flex gap-3 text-[10px] font-bold uppercase tracking-widest">
                <button onClick={() => setGroup('rep', true)} className="text-brand-text hover:underline">All</button>
                <button onClick={() => setGroup('rep', false)} className="text-fg/70 hover:text-fg">None</button>
              </div>
            </div>
            <div className="grid gap-2">
              {EXPORT_REPORTS.map(r => (
                <label key={r.key} className={chip(repOn(r.key))}>
                  <input type="checkbox" checked={repOn(r.key)} onChange={() => toggle('rep', r.key)} />
                  <span className="min-w-0">
                    <span className="block truncate">{r.label}</span>
                    <span className="block text-[10px] text-fg/70 font-normal">{r.note}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-page-bg border border-white/10 rounded-xl p-4 space-y-3">
          <p className="text-[10px] uppercase tracking-widest text-fg/70 font-bold">Date range</p>
          <div className="flex flex-wrap items-center gap-2">
            <RangePresets value={exportAllRange} onChange={r => setExportAllRange(p => ({ ...p, ...r }))} />
            <input type="date" value={exportAllRange.start}
              onChange={e => setExportAllRange(r => ({ ...r, start: e.target.value }))}
              className="bg-surface border border-white/15 text-fg rounded-lg px-3 py-2 text-sm" />
            <span className="text-fg/70 text-xs font-bold">to</span>
            <input type="date" value={exportAllRange.end}
              onChange={e => setExportAllRange(r => ({ ...r, end: e.target.value }))}
              className="bg-surface border border-white/15 text-fg rounded-lg px-3 py-2 text-sm" />
          </div>
          <p className="text-[10px] text-fg/70">
            {needsRange
              ? 'Used by the dated datasets and by the Journal and Audit Log files. Everything else exports in full.'
              : 'Nothing you have picked uses a date range - it will all export in full.'}
          </p>
        </div>

        {exportProgress && renderProgress(exportProgress, 'Working...')}

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => downloadAllExports?.({ start: exportAllRange.start, end: exportAllRange.end, datasets: pickedDs, reports: pickedRep })}
            disabled={!!exportAllBusy || nothing || exportDatasets === null || (needsRange && (!exportAllRange.start || !exportAllRange.end))}
            className="bg-brand text-on-brand font-black px-4 py-2 rounded-lg uppercase tracking-widest text-xs hover:bg-brand/90 transition disabled:opacity-50">
            {exportAllBusy ? 'Working...' : nothing ? 'Pick something to export' : `Export ${count} item${count === 1 ? '' : 's'}`}
          </button>
        </div>
        <p className="text-[10px] text-fg/70">
          Datasets and the reference sheets go into one workbook, led by a Contents sheet that lists row counts and flags any sheet that hit the row cap. The Journal and Audit Log download as their own PDF reports. Your browser may ask permission to save several files.
        </p>
      </div>
      </div>
      );
    })()}
    </>
  );
}
