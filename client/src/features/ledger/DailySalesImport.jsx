import { useEffect, useState } from 'react';
import { X, CheckCircle, AlertTriangle } from 'lucide-react';
import * as ui from '../../shared/ui';
import { dailyChecks, markRepeatedDays } from '../../shared/dailySales';

// A daily sales summary (one row per day: cash less discounts, a bank such as
// RCBC, Grab less commission, the cash deposits) imported as backdated sales
// (server: POST /api/orders/import-daily). Opened by Backdate Sale's Import
// Excel / Pull sheet when the workbook has that layout.

const peso = (n) => `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function DailySalesImport({ apiFetch, data, onClose, onDone }) {
  const [bankMethod, setBankMethod] = useState(data.bankLabel || 'Bank Transfer');
  const [payoutAccount, setPayoutAccount] = useState('112000');
  const [commissionAccount, setCommissionAccount] = useState('670000');
  const [postDeposits, setPostDeposits] = useState(true);
  const [depositAccount, setDepositAccount] = useState('112000');
  const [accounts, setAccounts] = useState([]);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    (async () => {
      try { const d = await (await apiFetch('/api/coa')).json(); if (d.success) setAccounts(d.accounts || []); } catch { /* the defaults stand */ }
    })();
  }, [apiFetch]);
  useEffect(() => { setPreview(null); }, [bankMethod, payoutAccount, commissionAccount, postDeposits, depositAccount]);

  const banks = accounts.filter((a) => /^11[23]/.test(a.code) && !a.isParent);
  const expenses = accounts.filter((a) => /^[67]/.test(a.code) && !a.isParent);
  const options = (list, fallback) => (list.length ? list : [{ code: fallback, name: fallback }])
    .map((a) => <option key={a.code} value={a.code}>{a.code} {a.name}</option>);
  const warnings = Object.fromEntries(data.rows.map((r) => [r.sheetRow, dailyChecks(r)]));
  // A workbook can hold years of days; the server takes them in batches.
  const BATCH = 200;
  const [progress, setProgress] = useState('');
  const send = async (rows, isPreview) => {
    const d = await (await apiFetch('/api/orders/import-daily', {
      method: 'POST',
      body: JSON.stringify({ rows, bankMethod, payoutAccount, commissionAccount, postDeposits, depositAccount, preview: isPreview }),
    })).json();
    if (!d.success) throw new Error(d.error || 'The import could not run.');
    return d;
  };
  const batches = (rows) => Array.from({ length: Math.ceil(rows.length / BATCH) }, (_, i) => rows.slice(i * BATCH, (i + 1) * BATCH));

  // The same date on two tabs (a period tab and a month tab, say) would be two
  // days of sales: the first is kept, the later ones are marked and left out.
  const summarise = (days, accounts) => {
    const use = days.filter((d) => !d.errors.length && !d.repeatOf);
    const sum = (f) => Math.round(use.reduce((s, d) => s + (f(d) || 0), 0) * 100) / 100;
    return {
      days: days.length, problems: days.filter((d) => d.errors.length).length, repeats: days.filter((d) => d.repeatOf).length,
      ready: use.filter((d) => Object.values(d.parts || {}).some((p) => p.status === 'ready')).length,
      cash: sum((d) => d.cash), discount: sum((d) => d.discount), bank: sum((d) => d.bank), grab: sum((d) => d.grab),
      commission: sum((d) => d.commission), deposits: sum((d) => d.parts?.deposit?.amount), accounts,
    };
  };

  const run = async (isPreview) => {
    setBusy(isPreview ? 'preview' : 'import');
    try {
      if (isPreview) {
        const all = []; let accounts = null;
        const parts = batches(data.rows);
        for (const [i, rows] of parts.entries()) {
          setProgress(parts.length > 1 ? `Checking ${i + 1} of ${parts.length}…` : '');
          const d = await send(rows, true);
          all.push(...d.days); accounts = d.summary.accounts;
        }
        const days = markRepeatedDays(all);
        setPreview({ days, summary: summarise(days, accounts) });
      } else {
        // Only the days the preview showed as usable: no problem rows, no repeats.
        const skip = new Set(preview.days.filter((d) => d.errors.length || d.repeatOf).map((d) => String(d.row)));
        const rows = data.rows.filter((r) => !skip.has(String(r.sheetRow)));
        const merged = { imported: 0, results: [] };
        const parts = batches(rows);
        for (const [i, chunk] of parts.entries()) {
          setProgress(parts.length > 1 ? `Importing ${i + 1} of ${parts.length}…` : '');
          const d = await send(chunk, false);
          merged.imported += d.imported; merged.results.push(...d.results);
        }
        setResult(merged); setPreview(null); onDone?.();
      }
    } catch (e) { ui.alert(e.message || 'Network error.'); }
    finally { setBusy(''); setProgress(''); }
  };
  const confirmImport = async () => {
    const s = preview.summary;
    const ok = await ui.confirm({
      title: `Import ${s.ready} day(s) of sales?`,
      message: `Cash ${peso(s.cash)} (less ${peso(s.discount)} discounts), ${bankMethod} ${peso(s.bank)}, Grab ${peso(s.grab)} less ${peso(s.commission)} commission${postDeposits ? `, and ${peso(s.deposits)} of deposits` : ''}. Each day is posted on its own date; days already imported are skipped.`,
      confirmLabel: 'Import',
    });
    if (ok) run(false);
  };

  const sel = 'mt-1 w-full bg-page-bg border border-white/10 rounded px-2 py-1 text-xs text-fg';
  return (
    <div className="fixed inset-0 z-[9998] bg-black/80 backdrop-blur-sm flex items-center justify-center p-3" onClick={onClose}>
      <div className="bg-surface border border-white/10 rounded-2xl w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
          <div>
            <h2 className="text-fg font-black text-lg">Daily sales summary</h2>
            <p className="text-[11px] text-fg/70">{data.rows.length} day(s) read{data.source ? ` from ${data.source}` : ''}. Each day becomes its cash, {bankMethod} and Grab sales, posted on that day.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-white/10 text-fg/70"><X size={18} /></button>
        </div>
        <div className="p-5 overflow-y-auto space-y-4">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs font-black text-fg">
            <label className="p-2.5 rounded-lg border border-white/10 bg-white/5">Bank sales are paid by
              <input value={bankMethod} onChange={(e) => setBankMethod(e.target.value)} className={sel} />
              <span className="block mt-1 text-[10px] font-normal text-fg/65">A payment method, or the name of a bank account you added (e.g. RCBC) - the sale posts there.</span>
            </label>
            <label className="p-2.5 rounded-lg border border-white/10 bg-white/5">Grab pays into
              <select value={payoutAccount} onChange={(e) => setPayoutAccount(e.target.value)} className={sel}>{options(banks, '112000')}</select>
            </label>
            <label className="p-2.5 rounded-lg border border-white/10 bg-white/5">Grab commission is booked to
              <select value={commissionAccount} onChange={(e) => setCommissionAccount(e.target.value)} className={sel}>{options(expenses, '670000')}</select>
            </label>
            <label className="p-2.5 rounded-lg border border-white/10 bg-white/5">
              <span className="flex items-center gap-2"><input type="checkbox" checked={postDeposits} onChange={(e) => setPostDeposits(e.target.checked)} /> Post the cash deposits</span>
              <select value={depositAccount} onChange={(e) => setDepositAccount(e.target.value)} disabled={!postDeposits} className={`${sel} disabled:opacity-50`}>{options(banks, '112000')}</select>
              <span className="block mt-1 text-[10px] font-normal text-fg/65">Cash after discount, moved to the bank on DATE DEPOSITED with the slip number.</span>
            </label>
          </div>

          {!preview && !result && (
            <div className="flex justify-end">
              <button onClick={() => run(true)} disabled={busy === 'preview'} className="px-4 py-2 rounded-lg bg-brand text-on-brand text-xs font-black disabled:opacity-50">{busy === 'preview' ? (progress || 'Checking…') : 'Preview'}</button>
            </div>
          )}

          {preview && (
            <div className="space-y-2">
              <div className="text-[11px] text-fg/80 flex flex-wrap gap-x-4 gap-y-1">
                <span><b>{preview.summary.ready}</b> day(s) to import{(() => { const already = preview.summary.days - preview.summary.ready - preview.summary.problems - preview.summary.repeats; return already > 0 ? `, ${already} already in` : ''; })()}{preview.summary.repeats ? <>, <b className="text-warning">{preview.summary.repeats} date(s) repeated on another tab (left out)</b></> : ''}{preview.summary.problems ? <>, <b className="text-danger">{preview.summary.problems} with problems</b></> : ''}</span>
                <span>Cash {peso(preview.summary.cash)} − {peso(preview.summary.discount)}</span>
                <span>{bankMethod} {peso(preview.summary.bank)}</span>
                <span>Grab {peso(preview.summary.grab)} − {peso(preview.summary.commission)}</span>
                {postDeposits && <span>Deposits {peso(preview.summary.deposits)}</span>}
              </div>
              <p className="text-[10px] text-fg/60">Posting to: {Object.values(preview.summary.accounts).join(' · ')}</p>
              <div className="max-h-80 overflow-auto rounded-lg border border-white/10">
                <table className="w-full text-[11px]">
                  <thead className="bg-white/5 text-fg/70 sticky top-0">
                    <tr>{['Date', 'Cash', 'Discount', bankMethod, 'Grab', 'Commission', 'Deposit', 'Status'].map((h) => <th key={h} className="text-left px-2 py-1.5 font-black">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {preview.days.map((d) => {
                      const parts = Object.values(d.parts || {});
                      const status = d.errors.length ? d.errors.join(' ')
                        : d.repeatOf ? `Same date as ${d.repeatOf} - left out${d.repeatDiffers ? ' (its numbers differ - check which tab is right)' : ''}`
                        : !parts.length ? 'Nothing to import'
                          : parts.every((p) => p.status === 'already') ? 'Already imported'
                            : parts.some((p) => p.status === 'already') ? 'Partly in - the rest will be added' : 'Ready';
                      const warn = warnings[d.row] || [];
                      return (
                        <tr key={d.row} className="border-t border-white/5 align-top">
                          <td className="px-2 py-1">{d.date}</td>
                          <td className="px-2 py-1 tabular-nums">{peso(d.cash)}</td>
                          <td className="px-2 py-1 tabular-nums">{d.discount ? <>{peso(d.discount)}<span className="block text-[9px] text-fg/60">{d.discountType}</span></> : ''}</td>
                          <td className="px-2 py-1 tabular-nums">{peso(d.bank)}</td>
                          <td className="px-2 py-1 tabular-nums">{peso(d.grab)}</td>
                          <td className="px-2 py-1 tabular-nums">{peso(d.commission)}</td>
                          <td className="px-2 py-1">{d.parts?.deposit ? <>{d.parts.deposit.date}<span className="block text-[9px] text-fg/60">{d.depositSlip}</span></> : ''}</td>
                          <td className={`px-2 py-1 ${d.errors.length ? 'text-danger' : status === 'Ready' ? 'text-success' : 'text-fg/60'}`}>
                            {status}
                            {warn.length > 0 && <span className="flex gap-1 text-warning text-[10px]"><AlertTriangle size={11} className="shrink-0 mt-0.5" />{warn.join('; ')}</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end">
                <button onClick={confirmImport} disabled={!preview.summary.ready || busy === 'import'} className="px-4 py-2 rounded-lg bg-brand text-on-brand text-xs font-black disabled:opacity-40">
                  {busy === 'import' ? (progress || 'Importing…') : `Import ${preview.summary.ready} day(s)`}
                </button>
              </div>
            </div>
          )}

          {result && (
            <div className="p-3 rounded-lg border border-success/30 bg-success/10 text-xs text-fg space-y-1">
              <p className="font-black flex items-center gap-1.5"><CheckCircle size={14} className="text-success" /> {result.imported} day(s) imported.</p>
              {result.results.filter((r) => r.failed.length).map((r) => <p key={r.row} className="text-danger">{r.date}: {r.failed.join('; ')}</p>)}
              <p className="text-fg/70">No stock was moved and no cost of sales was recorded: a daily summary does not say which items were sold. Your next stock count settles the stock, and its difference is booked then.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
