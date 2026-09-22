// Every import template in one workbook - and that workbook imported back.
//
// Setting a business up used to mean six downloads and six uploads, each from
// its own screen: suppliers from Procurement, bills from the Ledger, expenses
// from Expenses, and so on. This card hands over one workbook with a sheet per
// template, in the order they depend on each other, and takes the filled-in
// workbook back in one go. Each sheet still goes to the same importer its own
// screen uses, so the checks, the accounting and the error messages are the
// same ones.
import { useState } from 'react';
import { Download, Upload, FileSpreadsheet } from 'lucide-react';
import * as ui from '../../shared/ui';

// Dependency order: a bill names a supplier, so suppliers come first.
// `perm` is what the importer itself requires; a sheet the person cannot import
// is left out of the workbook rather than failing after they have filled it.
const TEMPLATES = [
  { key: 'suppliers', sheet: 'Suppliers', perm: (can) => can('procurement.manage') },
  { key: 'clients', sheet: 'Clients', perm: (can, su) => su, logOnly: true },
  { key: 'inventory', sheet: 'Inventory', perm: (can, su) => su, preview: true },
  { key: 'bills', sheet: 'Bills', perm: (can) => can('accounting.manage') },
  { key: 'expenses', sheet: 'Expenses', perm: (can) => can('accounting.manage') },
  { key: 'fixedAssets', sheet: 'Fixed Assets', perm: (can) => can('accounting.manage') },
];

const isBlank = (v) => v === '' || v === null || v === undefined;
// A date the person typed arrives as a Date; the importers take YYYY-MM-DD,
// on the calendar day shown - not the UTC one, a day earlier here.
const localDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const cellText = (v) => (v instanceof Date ? localDate(v) : String(v ?? '').trim());

export default function TemplatesCard({ apiFetch, can, isSuperAdmin, businessType, parseImportFile, onImported }) {
  const [busy, setBusy] = useState('');
  const [plan, setPlan] = useState(null);      // what an uploaded workbook would import
  const [report, setReport] = useState(null);  // what the last import did

  const available = TEMPLATES.filter((t) => (!t.logOnly || businessType === 'log') && t.perm(can, isSuperAdmin));

  // ── Download ───────────────────────────────────────────────────────────────
  const downloadAll = async () => {
    setBusy('Building the workbook…');
    try {
      const XLSX = await import('xlsx');
      const specs = [];
      for (const t of available) {
        const d = await (await apiFetch(`/api/export/${t.key}?template=1`)).json();
        if (d.success && d.importable) specs.push({ ...t, ...d });
      }
      if (!specs.length) { ui.alert('There is nothing here you have permission to import.'); return; }

      const wb = XLSX.utils.book_new();
      const readMe = [
        ['Setup workbook'],
        [],
        ['Fill in the sheets you need and leave the rest empty - an empty sheet is skipped.'],
        ['Row 2 of every sheet is an example. Overwrite it, or leave it exactly as it is and it will be ignored.'],
        ['Then bring the whole file back: Ledger → Export All → Import all.'],
        [],
        ['Sheet', 'What it adds', 'Done in this order because'],
        ...specs.map((s, i) => [s.sheet, s.intro || '', i === 0 ? 'Goes first.' : `Comes after ${specs.slice(0, i).map((x) => x.sheet).join(', ')}.`]),
        [],
        ['Menu products are not in this workbook - they have their own sheet with recipes and sizes: Menu Setup → Menu Sheet.'],
        ['"How to fill" lists every column: required or not, what to put, and an example. "Valid Values" and "Accounts" list the accepted entries.'],
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(readMe), 'Read me');
      for (const s of specs) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([s.columns, s.example]), s.sheet);

      const guide = [['Sheet', 'Column', 'Required?', 'What to put', 'Example']];
      for (const s of specs) for (const f of s.fields || []) guide.push([s.sheet, f.name, f.required ? 'REQUIRED' : 'optional', f.note || '', String(f.example ?? '')]);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(guide), 'How to fill');

      try {
        const vv = await (await apiFetch('/api/export/valid-values')).json();
        if (vv.success) {
          const keys = new Set(specs.map((s) => s.key));
          const rows = vv.table.filter((t) => keys.has(t.dataset)).map((t) => [t.dataset, t.column, t.values.join(' | '), t.note]);
          XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([vv.columns, ...rows]), 'Valid Values');
        }
      } catch { /* still usable without it */ }
      try {
        const acc = await (await apiFetch('/api/export/account-balances')).json();
        if (acc.success) {
          const codeIdx = acc.columns.findIndex((c) => /code/i.test(String(c)));
          const nameIdx = acc.columns.findIndex((c) => /name/i.test(String(c)));
          const rows = (acc.rows || []).map((r) => [r[codeIdx >= 0 ? codeIdx : 0], r[nameIdx >= 0 ? nameIdx : 1]]);
          XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Code', 'Account'], ...rows]), 'Accounts');
        }
      } catch { /* still usable without it */ }

      XLSX.writeFile(wb, 'Setup-workbook.xlsx');
    } catch {
      ui.alert('Could not build the workbook. Check the connection and try again.');
    } finally { setBusy(''); }
  };

  // ── Read an uploaded workbook ───────────────────────────────────────────────
  const readWorkbook = async (file) => {
    if (!file) return;
    setReport(null);
    setBusy('Reading the workbook…');
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const steps = [];
      for (const t of available) {
        const ws = wb.Sheets[t.sheet];
        if (!ws) continue;
        const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });   // blank rows kept, so row numbers match the sheet
        if (grid.length < 2) continue;
        const header = grid[0].map((h) => String(h ?? '').trim());
        // The example row, as the template wrote it, so an untouched one is skipped.
        let example = null;
        try {
          const d = await (await apiFetch(`/api/export/${t.key}?template=1`)).json();
          if (d.success) example = (d.example || []).map((v) => String(v ?? '').trim());
        } catch { /* compare nothing */ }
        // Keep each row's number in the spreadsheet, so "row 7" in a message
        // is row 7 on screen - not the 7th row left after blanks and the
        // example were taken out.
        const kept = [];
        let skippedExample = 0;
        grid.slice(1).forEach((row, i) => {
          if (!row.some((v) => !isBlank(v))) return;
          if (example && header.every((_, c) => cellText(row[c]) === (example[c] ?? ''))) { skippedExample++; return; }
          kept.push({ row, sheetRow: i + 2 });
        });
        if (!kept.length) continue;
        steps.push({ ...t, header, grid: [grid[0], ...kept.map((k) => k.row)], sheetRows: kept.map((k) => k.sheetRow), count: kept.length, skippedExample });
      }
      if (!steps.length) {
        ui.alert('Nothing to import: every sheet you can import is empty or still holds only the example row. Use the workbook from "Download all templates".');
        return;
      }
      setPlan({ file, steps });
    } catch {
      ui.alert('Could not read that file. It should be the workbook from "Download all templates", saved as .xlsx.');
    } finally { setBusy(''); }
  };

  // ── Import ─────────────────────────────────────────────────────────────────
  const runImport = async () => {
    const { steps } = plan;
    setPlan(null);
    const results = [];
    let inventoryStep = null;
    for (const s of steps) {
      if (s.preview) { inventoryStep = s; continue; }   // opens its own preview, last
      setBusy(`Importing ${s.sheet}…`);
      const rows = s.grid.slice(1).map((row) => Object.fromEntries(s.header.map((h, i) => {
        const v = row[i];
        return [h, v instanceof Date ? localDate(v) : v];
      })));
      try {
        const d = await (await apiFetch(`/api/${endpointFor(s.key)}`, { method: 'POST', body: JSON.stringify({ rows }) })).json();
        results.push({
          sheet: s.sheet, ok: !!d.success,
          created: d.created ?? d.imported ?? (d.success ? rows.length - (d.skipped || []).length : 0),
          skipped: (d.skipped || []).map((x) => `Row ${s.sheetRows[(Number(x.row) || 1) - 1] ?? x.row}: ${x.error || x.reason || 'not added'}`),
          error: d.success ? '' : (d.error || 'Import failed.'),
          extra: d.note || '',
        });
      } catch {
        results.push({ sheet: s.sheet, ok: false, created: 0, skipped: [], error: 'No connection to the server.' });
      }
    }
    setBusy('');
    setReport({ results, inventory: inventoryStep ? inventoryStep.count : 0 });
    onImported?.();

    // Stock goes through the Inventory import's own preview - units, pack
    // sizes and categories are worth a look before they land - with the
    // example row already taken out.
    if (inventoryStep && parseImportFile) {
      const XLSX = await import('xlsx');
      const out = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(out, XLSX.utils.aoa_to_sheet(inventoryStep.grid), 'Inventory');
      const bytes = XLSX.write(out, { type: 'array', bookType: 'xlsx' });
      const f = new File([bytes], 'Inventory.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      parseImportFile(f);
    }
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
            the same import its screen uses, in the right order.
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

function endpointFor(key) {
  return {
    suppliers: 'suppliers/import',
    clients: 'client-accounts/import',
    bills: 'bills/import',
    expenses: 'expenses/import',
    fixedAssets: 'fixed-assets/import',
  }[key];
}
