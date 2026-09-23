import { useState } from 'react';
import { FileSpreadsheet, Download, Link2, AlertTriangle } from 'lucide-react';
import * as ui from '../../shared/ui';
import GoogleSheetModal, { useInventorySheet, pullWorkbook } from '../inventory/GoogleSheetLink';
import { availableTemplates, buildSetupWorkbook, readSetupWorkbook, runSetupImport } from '../../shared/setupWorkbook';

// The setup workbook, kept in Google Sheets.
//
// The same workbook as "Start from templates" (Ledger → Export All) - one tab
// per thing the business has to type in: suppliers, clients, stock, bills,
// expenses, fixed assets. Linked here, it can be filled in by whoever keeps
// the records and pulled in when it is ready, instead of being downloaded,
// filled in, and uploaded again.
//
// Pulling never applies anything blindly: each tab goes to the same importer
// its own screen uses, and stock still opens the count preview to confirm.
const BASE = '/api/setup-sheet';

export default function SetupSheetCard({ apiFetch, can, isSuperAdmin, businessType, parseImportFile, onImported }) {
  const [sheet, setSheet, reload] = useInventorySheet(apiFetch, !!isSuperAdmin, BASE);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [plan, setPlan] = useState(null);
  const [report, setReport] = useState(null);

  const available = availableTemplates(can, isSuperAdmin, businessType);
  const linked = !!sheet?.url;

  const download = async () => {
    setBusy('Building the workbook…');
    try {
      const XLSX = await import('xlsx');
      const wb = await buildSetupWorkbook(XLSX, available, apiFetch);
      if (!wb) { ui.alert('There is nothing here you have permission to import.'); return; }
      XLSX.writeFile(wb, 'Setup-workbook.xlsx');
    } catch { ui.alert('Could not build the workbook. Check the connection and try again.'); }
    finally { setBusy(''); }
  };

  // Read the linked workbook and say what it would import, before it does.
  const pull = async () => {
    setOpen(false); setReport(null);
    setBusy('Reading the linked workbook…');
    try {
      const { XLSX, wb } = await pullWorkbook(apiFetch, BASE);
      const steps = await readSetupWorkbook(XLSX, wb, available, apiFetch);
      if (!steps.length) {
        ui.alert('Nothing to import: every tab you can import is empty or still holds only the example row. The tabs must be named '
          + available.map((t) => t.sheet).join(', ') + '.');
        return;
      }
      setPlan(steps);
    } catch (e) { ui.alert(e.message); }
    finally { setBusy(''); reload(); }
  };

  const runImport = async () => {
    const steps = plan;
    setPlan(null);
    const done = await runSetupImport(steps, { apiFetch, parseImportFile, onProgress: setBusy });
    setReport(done);
    onImported?.();
    reload();
  };

  const btn = 'flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest transition disabled:opacity-50';
  return (
    <div>
      <p className="text-[11px] font-black uppercase tracking-wider text-fg/65 mb-2 px-1">Setup workbook from Google Sheets</p>
      <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-4">
        <p className="text-xs text-fg/75 leading-relaxed">
          One workbook holding everything the business has to type in - {available.map((t) => t.sheet).join(', ') || 'nothing you can import'} -
          kept in Google Sheets. Download it, upload it to your Drive, share it as <b>Viewer</b>, then link it here. Each tab goes to the same
          import its own screen uses, and stock opens the count preview first.
        </p>

        {sheet?.changedAt && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-amber-500/60 bg-sidebar-bg px-4 py-3">
            <AlertTriangle size={16} className="text-warning" />
            <p className="flex-1 min-w-[12rem] text-xs text-fg/85">
              <span className="font-black">Your setup workbook changed</span> since your last pull. Pull it to see what it would add - nothing is
              imported until you confirm.
            </p>
          </div>
        )}
        {sheet?.lastCheckError && (
          <p className="text-xs text-danger"><b>Couldn&apos;t read your setup workbook.</b> {sheet.lastCheckError}</p>
        )}

        <div className="flex flex-wrap gap-2">
          <button onClick={download} disabled={!!busy || !available.length} className={`${btn} bg-brand text-on-brand hover:bg-brand-dark`}>
            <Download size={14} /> Download the workbook
          </button>
          <button onClick={() => setOpen(true)} disabled={!!busy} className={`${btn} bg-white/5 border border-white/10 text-fg/85 hover:text-fg hover:border-white/30`}>
            <Link2 size={14} /> {linked ? 'Linked sheet settings' : 'Link a Google Sheet'}
          </button>
          {linked && (
            <button onClick={pull} disabled={!!busy} className={`${btn} bg-white/5 border border-white/10 text-fg/85 hover:text-fg hover:border-white/30`}>
              <FileSpreadsheet size={14} /> Pull and import
            </button>
          )}
        </div>

        {busy && <p className="text-xs font-bold text-fg/80" role="status" aria-live="polite">{busy}</p>}

        {plan && (
          <div className="border border-white/10 rounded-xl p-4 space-y-3">
            <p className="text-sm font-bold text-fg">This workbook will import:</p>
            <ol className="space-y-1 text-sm">
              {plan.map((s, i) => (
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
          <div className="border border-white/10 rounded-xl p-4 space-y-2 text-sm">
            <p className="font-bold text-fg">Import finished</p>
            {report.results.map((r) => (
              <div key={r.sheet}>
                <p className={r.ok ? 'text-fg' : 'text-danger'}>
                  <b>{r.sheet}:</b> {r.ok ? `${r.created} added` : r.error}{r.ok && r.skipped.length ? `, ${r.skipped.length} not added` : ''}
                </p>
                {r.skipped.length > 0 && (
                  <ul className="mt-1 ml-4 list-disc text-xs text-fg/75 space-y-0.5">{r.skipped.slice(0, 20).map((x, i) => <li key={i}>{x}</li>)}</ul>
                )}
              </div>
            ))}
            {report.inventory > 0 && (
              <p className="text-fg"><b>Inventory:</b> {report.inventory} row(s) opened in the stock count preview - confirm them there.</p>
            )}
          </div>
        )}
      </div>

      {open && (
        <GoogleSheetModal
          apiFetch={apiFetch} base={BASE} sheet={sheet} setSheet={setSheet}
          title="Setup workbook" pullLabel="Pull and import"
          intro="Link the Google Sheet holding your setup workbook - the one with a tab per import."
          pullNote="Pull and import reads the tabs you chose and shows what they would add before anything is imported. Stock opens the count preview, where quantities replace what the system holds."
          onPull={pull} pulling={!!busy} onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
