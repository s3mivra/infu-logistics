import { useState, useEffect, useCallback } from 'react';
import { X, Download, Upload, Link2, RefreshCw, FileSpreadsheet, AlertTriangle, CheckCircle } from 'lucide-react';
import * as ui from '../../shared/ui';
import GoogleSheetModal, { useInventorySheet, pullWorkbook } from './GoogleSheetLink';
import { PURCHASE_COLUMNS, readPurchaseWorkbook } from '../../shared/purchaseSheet';

// Purchases from a spreadsheet: an Excel file or the linked purchases Google
// Sheet (server: features/purchases.js). Every import is previewed first; the
// two switches decide whether it adds stock and whether it posts to the books -
// for backdated purchases, either may already be accounted for.
//
// Permissions (enforced by the server, reflected here): inventory.manage to
// import; the backdate permission for dates before today; accounting or fund
// rights to post money; Export All to export the list.

const SHEET_BASE = '/api/purchases-sheet';
const peso = (n) => `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const todayIso = () => new Date().toLocaleDateString('en-CA');

export default function PurchasesImportModal({ apiFetch, can, onClose, onDone }) {
  const canPostMoney = can?.('accounting.manage') || can?.('funds.spend');
  const canBackdate = can?.('sales.backdate');
  const canExport = can?.('screen.ledger.exportall');

  const [tab, setTab] = useState('import');               // 'import' | 'list'
  const [rows, setRows] = useState(null);                 // read from the sheet
  const [source, setSource] = useState('');
  const [affectStock, setAffectStock] = useState(true);
  const [affectMoney, setAffectMoney] = useState(!!canPostMoney);
  const [paidFrom, setPaidFrom] = useState('Cash');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState(null);

  const [sheet, setSheet, reloadSheet] = useInventorySheet(apiFetch, true, SHEET_BASE);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Any change to what is read or how it is applied needs a fresh preview.
  useEffect(() => { setPreview(null); setResult(null); }, [rows, affectStock, affectMoney, paidFrom]);

  const takeWorkbook = (XLSX, wb, label) => {
    const { rows: got, used, skipped } = readPurchaseWorkbook(XLSX, wb);
    if (!used.length) {
      ui.alert(`No tab has the purchase columns. Needed: Date, Product Code (or Product), Qty, Amount Paid.${skipped.length ? ` ${skipped.map((s) => `${s.name}: missing ${s.missing.join(', ')}`).join('; ')}.` : ''}`);
      return;
    }
    setRows(got);
    setSource(`${label} - ${used.join(', ')}${skipped.length ? ` (skipped ${skipped.map((s) => s.name).join(', ')})` : ''}`);
    setTab('import');
  };

  const readFile = async (file) => {
    if (!file) return;
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      takeWorkbook(XLSX, wb, file.name);
    } catch { ui.alert('That file could not be read. Save it as .xlsx and try again.'); }
  };

  const pull = async () => {
    setBusy('pull');
    try {
      const { XLSX, wb } = await pullWorkbook(apiFetch, SHEET_BASE);
      takeWorkbook(XLSX, wb, 'Google Sheet');
      reloadSheet();
    } catch (e) { ui.alert(e.message || 'Could not pull the sheet.'); }
    finally { setBusy(''); }
  };

  const downloadTemplate = async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([PURCHASE_COLUMNS.map((c) => c.label), PURCHASE_COLUMNS.map((c) => c.example)]);
    ws['!cols'] = PURCHASE_COLUMNS.map((c) => ({ wch: Math.max(12, c.label.length + 2) }));
    XLSX.utils.book_append_sheet(wb, ws, 'Purchases');
    const help = XLSX.utils.aoa_to_sheet([
      ['How to fill this in'],
      ['One row per item bought. Rows with the same Reference are one receipt.'],
      ['Date: when it was bought, e.g. 2026-11-13. A date before today needs the backdate permission.'],
      ['Product Code: the stock item\'s code in Inventory (or leave it blank and give the Product name).'],
      ['Qty: in the unit the stock screen shows (packs / pcs, or kg / L).'],
      ['Amount Paid: the total for that row, not the price of one.'],
      ['Paid From: Cash, Bank or Credit. Blank uses the choice made on the import screen.'],
    ]);
    help['!cols'] = [{ wch: 100 }];
    XLSX.utils.book_append_sheet(wb, help, 'Instructions');
    XLSX.writeFile(wb, 'Purchases_Template.xlsx');
  };

  const send = async (isPreview) => {
    if (!rows?.length) return;
    setBusy(isPreview ? 'preview' : 'import');
    try {
      const r = await apiFetch('/api/purchases/import', {
        method: 'POST',
        body: JSON.stringify({ rows, affectStock, affectMoney, paidFrom, preview: isPreview }),
      });
      const d = await r.json().catch(() => ({}));
      if (!d.success) { ui.alert(d.error || 'The import could not run.'); return; }
      if (isPreview) setPreview(d);
      else { setResult(d); setPreview(null); setRows(null); onDone?.(); }
    } catch { ui.alert('Network error.'); }
    finally { setBusy(''); }
  };

  const confirmImport = async () => {
    const s = preview.summary;
    const what = affectStock && affectMoney ? 'add the stock AND post the payments to the books'
      : affectStock ? 'add the stock only (nothing posted to the books)'
        : affectMoney ? 'post the payments to the books only (no stock added)'
          : 'only record the purchases (no stock, no books)';
    const ok = await ui.confirm({
      title: `Import ${s.ready} purchase${s.ready === 1 ? '' : 's'} (${peso(s.totalPaid)})?`,
      message: `This will ${what}.${s.backdated ? ` ${s.backdated} of them are backdated.` : ''}${s.errors + s.duplicates ? ` ${s.errors + s.duplicates} row(s) will be skipped.` : ''}`,
      confirmLabel: 'Import',
    });
    if (ok) send(false);
  };

  // ── Recorded purchases ──────────────────────────────────────────────────────
  const [range, setRange] = useState({ start: todayIso().slice(0, 8) + '01', end: todayIso() });
  const [list, setList] = useState(null);
  const loadList = useCallback(async () => {
    try {
      const d = await (await apiFetch(`/api/purchases?start=${range.start}&end=${range.end}`)).json();
      setList(d.success ? d : { purchases: [], total: 0, error: d.error });
    } catch { setList({ purchases: [], total: 0, error: 'Network error.' }); }
  }, [apiFetch, range.start, range.end]);
  useEffect(() => { if (tab === 'list') loadList(); }, [tab, loadList]);

  const exportList = async () => {
    if (!list?.purchases?.length) return ui.alert('No purchases in this range to export.');
    const XLSX = await import('xlsx');
    const data = list.purchases.map((p) => ({
      Date: new Date(p.date).toLocaleDateString('en-CA'), Reference: p.reference, 'Product Code': p.itemCode, Product: p.itemName,
      Qty: p.qty, Unit: p.unit, 'Amount Paid': p.amountPaid, 'Unit Cost': p.unitCost, Supplier: p.supplier, 'Paid From': p.paidFrom,
      'Added to stock': p.affectsStock ? 'Yes' : 'No', 'Posted to books': p.affectsMoney ? 'Yes' : 'No',
      'Stock ref': p.stockRef, 'Journal ref': p.journalRef, 'Imported by': p.importedBy,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Purchases');
    XLSX.writeFile(wb, `Purchases_${range.start}_to_${range.end}.xlsx`);
  };

  const Toggle = ({ on, set, label, hint, disabled }) => (
    <label className={`flex items-start gap-2 p-2.5 rounded-lg border ${on ? 'border-brand/40 bg-brand/10' : 'border-white/10 bg-white/5'} ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => set(e.target.checked)} className="mt-0.5 accent-current" />
      <span><span className="block text-xs font-black text-fg">{label}</span><span className="block text-[10px] text-fg/70">{hint}</span></span>
    </label>
  );

  return (
    <div className="fixed inset-0 z-[9998] bg-black/80 backdrop-blur-sm flex items-center justify-center p-3" onClick={onClose}>
      <div className="bg-surface border border-white/10 rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
          <h2 className="text-fg font-black text-lg flex items-center gap-2"><FileSpreadsheet size={18} /> Purchases</h2>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-white/10 text-fg/70"><X size={18} /></button>
        </div>
        <div className="flex gap-1 px-5 pt-3">
          {[['import', 'Import'], ['list', 'Recorded purchases']].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-3 py-1.5 rounded-lg text-xs font-black ${tab === k ? 'bg-brand text-on-brand' : 'bg-white/5 text-fg/70 hover:text-fg'}`}>{l}</button>
          ))}
        </div>

        {tab === 'import' ? (
          <div className="p-5 overflow-y-auto space-y-4">
            <div className="flex flex-wrap gap-2">
              <button onClick={downloadTemplate} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs font-bold text-fg hover:border-brand/50"><Download size={13} /> Template</button>
              <label className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs font-bold text-fg hover:border-brand/50 cursor-pointer">
                <Upload size={13} /> Upload Excel
                <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { readFile(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
              <button onClick={() => setSheetOpen(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs font-bold text-fg hover:border-brand/50">
                <Link2 size={13} /> Google Sheet{sheet?.url ? (sheet.changedAt ? ' · changed' : ' · linked') : ''}
              </button>
              {sheet?.url && (
                <button onClick={pull} disabled={busy === 'pull'} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs font-bold text-fg hover:border-brand/50 disabled:opacity-50">
                  <RefreshCw size={13} className={busy === 'pull' ? 'animate-spin' : ''} /> Pull the sheet
                </button>
              )}
            </div>
            <p className="text-[11px] text-fg/70">Columns: <b>Date, Reference, Product Code (or Product), Qty, Amount Paid</b>; optional Supplier, Paid From, Notes. Qty is in the unit the stock screen shows.{!canBackdate && ' Rows dated before today need the backdate permission, which you do not have.'}</p>

            <div className="grid sm:grid-cols-3 gap-2">
              <Toggle on={affectStock} set={setAffectStock} label="Add to stock" hint="Adds the quantity at the price paid (average cost), dated on the purchase." />
              <Toggle on={affectMoney} set={setAffectMoney} disabled={!canPostMoney} label="Post to the books"
                hint={canPostMoney ? 'Inventory asset up, cash / bank / payable down, on the purchase date.' : 'Needs accounting or fund-spending rights.'} />
              <label className="p-2.5 rounded-lg border border-white/10 bg-white/5 text-xs font-black text-fg">
                Paid from (when the sheet does not say)
                <select value={paidFrom} onChange={(e) => setPaidFrom(e.target.value)} disabled={!affectMoney}
                  className="mt-1 w-full bg-page-bg border border-white/10 rounded px-2 py-1 text-xs disabled:opacity-50">
                  <option>Cash</option><option>Bank</option><option value="Credit">On credit (payable)</option>
                </select>
              </label>
            </div>
            {(!affectStock || !affectMoney) && (
              <p className="text-[11px] text-warning flex gap-1.5"><AlertTriangle size={13} className="shrink-0 mt-0.5" />
                {!affectStock && !affectMoney ? 'Only recorded: stock and the books stay as they are. Use this for purchases already counted and already in the opening balances.'
                  : !affectStock ? 'The books will show the purchase but stock will not go up - use this when the stock was already counted in.'
                    : 'Stock goes up but nothing is posted - use this when the payment is already in the books (for example the opening balance). Stock value and the books will differ by this amount.'}
              </p>
            )}

            {rows && (
              <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-white/5 border border-white/10">
                <span className="text-xs text-fg/80"><b>{rows.length}</b> row(s) read from {source}</span>
                <button onClick={() => send(true)} disabled={busy === 'preview'} className="px-3 py-1.5 rounded-lg bg-brand text-on-brand text-xs font-black disabled:opacity-50">
                  {busy === 'preview' ? 'Checking…' : 'Preview'}
                </button>
              </div>
            )}

            {preview && (
              <div className="space-y-2">
                <p className="text-xs text-fg/80">
                  <b className="text-success">{preview.summary.ready} ready</b> ({peso(preview.summary.totalPaid)})
                  {preview.summary.backdated ? ` · ${preview.summary.backdated} backdated` : ''}
                  {preview.summary.duplicates ? ` · ${preview.summary.duplicates} already in` : ''}
                  {preview.summary.errors ? <> · <b className="text-danger">{preview.summary.errors} with problems</b></> : ''}
                </p>
                <div className="max-h-72 overflow-auto rounded-lg border border-white/10">
                  <table className="w-full text-[11px]">
                    <thead className="bg-white/5 text-fg/70 sticky top-0">
                      <tr>{['Row', 'Date', 'Reference', 'Code', 'Product', 'Qty', 'Amount', 'Status'].map((h) => <th key={h} className="text-left px-2 py-1.5 font-black">{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {preview.lines.map((l) => (
                        <tr key={l.row} className="border-t border-white/5">
                          <td className="px-2 py-1 text-fg/60">{l.row}</td>
                          <td className="px-2 py-1">{l.date || ''}{l.backdated && <span className="ml-1 text-[9px] text-warning font-black">PAST</span>}</td>
                          <td className="px-2 py-1">{l.reference || ''}</td>
                          <td className="px-2 py-1">{l.itemCode || ''}</td>
                          <td className="px-2 py-1">{l.itemName || ''}</td>
                          <td className="px-2 py-1 tabular-nums">{l.qty != null ? `${l.qty} ${l.unit || ''}` : ''}</td>
                          <td className="px-2 py-1 tabular-nums">{l.amountPaid != null ? peso(l.amountPaid) : ''}</td>
                          <td className={`px-2 py-1 ${l.status === 'ok' ? 'text-success' : l.status === 'duplicate' ? 'text-fg/60' : 'text-danger'}`}>
                            {l.status === 'ok' ? 'Ready' : l.status === 'duplicate' ? l.note : l.error}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-end">
                  <button onClick={confirmImport} disabled={!preview.summary.ready || busy === 'import'}
                    className="px-4 py-2 rounded-lg bg-brand text-on-brand text-xs font-black disabled:opacity-40">
                    {busy === 'import' ? 'Importing…' : `Import ${preview.summary.ready}`}
                  </button>
                </div>
              </div>
            )}

            {result && (
              <div className="p-3 rounded-lg border border-success/30 bg-success/10 text-xs text-fg">
                <p className="font-black flex items-center gap-1.5"><CheckCircle size={14} className="text-success" /> {result.imported} purchase(s) imported.</p>
                {result.failed?.length > 0 && <p className="text-danger mt-1">{result.failed.length} could not be imported: {result.failed.map((f) => `row ${f.row} (${f.error})`).join('; ')}</p>}
              </div>
            )}
          </div>
        ) : (
          <div className="p-5 overflow-y-auto space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[10px] font-black text-fg/70">From<input type="date" value={range.start} onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))} className="block bg-page-bg border border-white/10 rounded px-2 py-1 text-xs text-fg" /></label>
              <label className="text-[10px] font-black text-fg/70">To<input type="date" value={range.end} onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))} className="block bg-page-bg border border-white/10 rounded px-2 py-1 text-xs text-fg" /></label>
              <button onClick={loadList} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs font-bold text-fg">Show</button>
              {canExport && <button onClick={exportList} className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand text-on-brand text-xs font-black"><Download size={13} /> Export Excel</button>}
            </div>
            {!canExport && <p className="text-[10px] text-fg/60">Exporting needs the Export All permission.</p>}
            {list && (
              <>
                <p className="text-xs text-fg/80">{list.purchases.length} purchase(s) · {peso(list.total)}</p>
                <div className="max-h-96 overflow-auto rounded-lg border border-white/10">
                  <table className="w-full text-[11px]">
                    <thead className="bg-white/5 text-fg/70 sticky top-0">
                      <tr>{['Date', 'Reference', 'Code', 'Product', 'Qty', 'Paid', 'Supplier', 'Stock', 'Books'].map((h) => <th key={h} className="text-left px-2 py-1.5 font-black">{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {list.purchases.map((p) => (
                        <tr key={p._id} className="border-t border-white/5">
                          <td className="px-2 py-1">{new Date(p.date).toLocaleDateString('en-CA')}</td>
                          <td className="px-2 py-1">{p.reference}</td>
                          <td className="px-2 py-1">{p.itemCode}</td>
                          <td className="px-2 py-1">{p.itemName}</td>
                          <td className="px-2 py-1 tabular-nums">{p.qty} {p.unit}</td>
                          <td className="px-2 py-1 tabular-nums">{peso(p.amountPaid)}</td>
                          <td className="px-2 py-1">{p.supplier}</td>
                          <td className="px-2 py-1">{p.affectsStock ? 'Added' : '-'}</td>
                          <td className="px-2 py-1">{p.affectsMoney ? 'Posted' : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {sheetOpen && (
        <div onClick={(e) => e.stopPropagation()}>
          <GoogleSheetModal apiFetch={apiFetch} sheet={sheet} setSheet={setSheet} base={SHEET_BASE}
            title="Purchases Google Sheet"
            intro="Link the Google Sheet you record purchases in. Share it as &quot;Anyone with the link can view&quot;."
            pullLabel="Pull the sheet"
            pullNote="Pulling opens the purchases in the preview here - nothing is imported until you confirm. Rows already imported are skipped, so pulling the same sheet again is safe."
            onPull={() => { setSheetOpen(false); pull(); }} pulling={busy === 'pull'} onClose={() => setSheetOpen(false)} />
        </div>
      )}
    </div>
  );
}
