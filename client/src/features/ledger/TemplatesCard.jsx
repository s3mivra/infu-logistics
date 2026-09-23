// Every import template in one workbook - and that workbook imported back.
//
// Setting a business up used to mean six downloads and six uploads, each from
// its own screen: suppliers from Procurement, bills from the Ledger, expenses
// from Expenses, and so on. This card hands over one workbook with a sheet per
// template, in the order they depend on each other, and takes the filled-in
// workbook back in one go. Each sheet still goes to the same importer its own
// screen uses, so the checks, the accounting and the error messages are the
// same ones.
//
// The reading and importing live in shared/setupWorkbook.js, because Settings
// does the same thing with the same workbook pulled from a linked Google Sheet.
import { useState } from 'react';
import { Download, Upload, FileSpreadsheet } from 'lucide-react';
import * as ui from '../../shared/ui';
import { availableTemplates, buildSetupWorkbook, readSetupWorkbook, runSetupImport } from '../../shared/setupWorkbook';

export default function TemplatesCard({ apiFetch, can, isSuperAdmin, businessType, parseImportFile, onImported }) {
  const [busy, setBusy] = useState('');
  const [plan, setPlan] = useState(null);      // what an uploaded workbook would import
  const [report, setReport] = useState(null);  // what the last import did

  const available = availableTemplates(can, isSuperAdmin, businessType);

  const downloadAll = async () => {
    setBusy('Building the workbook…');
    try {
      const XLSX = await import('xlsx');
      const wb = await buildSetupWorkbook(XLSX, available, apiFetch);
      if (!wb) { ui.alert('There is nothing here you have permission to import.'); return; }
      XLSX.writeFile(wb, 'Setup-workbook.xlsx');
    } catch {
      ui.alert('Could not build the workbook. Check the connection and try again.');
    } finally { setBusy(''); }
  };

  const readWorkbook = async (file) => {
    if (!file) return;
    setReport(null);
    setBusy('Reading the workbook…');
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const steps = await readSetupWorkbook(XLSX, wb, available, apiFetch);
      if (!steps.length) {
        ui.alert('Nothing to import: every sheet you can import is empty or still holds only the example row. Use the workbook from "Download all templates".');
        return;
      }
      setPlan({ file, steps });
    } catch {
      ui.alert('Could not read that file. It should be the workbook from "Download all templates", saved as .xlsx.');
    } finally { setBusy(''); }
  };

  const runImport = async () => {
    const { steps } = plan;
    setPlan(null);
    const done = await runSetupImport(steps, { apiFetch, parseImportFile, onProgress: setBusy });
    setReport(done);
    onImported?.();
  };

  const btn = 'flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest transition disabled:opacity-50';
  return (
    <div className="bg-surface border border-white/10 rounded-2xl p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-xl font-black text-fg flex items-center gap-2"><FileSpreadsheet size={18} className="text-brand-text" /> Start from templates</h3>
          <p className="text-fg/70 text-xs mt-1 max-w-prose leading-snug">
            Every import template in one workbook - {available.map((t) => t.sheet).join(', ') || 'none you can import'} - each sheet in the
            same format as that screen's own template. Fill in what you need and bring the whole file back here; each sheet goes to
            the same import its screen uses, in the right order. Keeping it in Google Sheets instead? Link it in Settings.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={downloadAll} disabled={!!busy || !available.length} className={`${btn} bg-brand text-on-brand hover:bg-brand/90`}>
            <Download size={14} /> Download all templates
          </button>
          <label className={`${btn} border border-white/15 text-fg/80 ${busy || !available.length ? 'opacity-50' : 'cursor-pointer hover:bg-white/5 hover:text-fg'}`}>
            <Upload size={14} /> Import all
            <input type="file" accept=".xlsx,.xls" className="hidden" disabled={!!busy || !available.length}
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; readWorkbook(f); }} />
          </label>
        </div>
      </div>

      {busy && <p className="mt-4 text-xs font-bold text-fg/80" role="status" aria-live="polite">{busy}</p>}

      {plan && (
        <div className="mt-4 border border-white/10 rounded-xl p-4 space-y-3">
          <p className="text-sm font-bold text-fg">This workbook will import:</p>
          <ol className="space-y-1 text-sm">
            {plan.steps.map((s, i) => (
              <li key={s.key} className="flex justify-between gap-3">
                <span className="text-fg">{i + 1}. {s.sheet}</span>
                <span className="text-fg/75 tabular-nums">
                  {s.count} row{s.count === 1 ? '' : 's'}{s.skippedExample ? ' (example row skipped)' : ''}{s.preview ? ' · opens a preview first' : ''}
                </span>
              </li>
            ))}
          </ol>
          <p className="text-xs text-fg/70">
            Expenses and fixed assets post to the books as they import. Bills arrive as Pending and post nothing until approved.
          </p>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setPlan(null)} className="px-4 py-2 rounded-lg text-sm font-bold text-fg/80 hover:text-fg hover:bg-white/5">Cancel</button>
            <button onClick={runImport} className="bg-brand text-on-brand px-4 py-2 rounded-lg text-sm font-black uppercase tracking-wider">Import</button>
          </div>
        </div>
      )}

      {report && (
        <div className="mt-4 border border-white/10 rounded-xl p-4 space-y-3 text-sm">
          <p className="font-bold text-fg">Import finished</p>
          {report.results.map((r) => (
            <div key={r.sheet}>
              <p className={r.ok ? 'text-fg' : 'text-danger'}>
                <b>{r.sheet}:</b> {r.ok ? `${r.created} added` : r.error}{r.ok && r.skipped.length ? `, ${r.skipped.length} not added` : ''}
              </p>
              {r.skipped.length > 0 && (
                <ul className="mt-1 ml-4 list-disc text-xs text-fg/75 space-y-0.5">{r.skipped.slice(0, 20).map((x, i) => <li key={i}>{x}</li>)}</ul>
              )}
              {r.extra && <p className="text-xs text-fg/70 mt-0.5">{r.extra}</p>}
            </div>
          ))}
          {report.inventory > 0 && (
            <p className="text-fg"><b>Inventory:</b> {report.inventory} row(s) opened in the stock import preview - confirm them there.</p>
          )}
        </div>
      )}
    </div>
  );
}
