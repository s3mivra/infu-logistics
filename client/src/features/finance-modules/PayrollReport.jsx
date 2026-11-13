import { useState } from 'react';
import { X, Printer, Download } from 'lucide-react';
import * as ui from '../../shared/ui';
import { formatPeso as peso } from '../../shared/money.js';
import { formatDate } from '../../shared/dates.js';
import { monthStartStr, todayStr } from '../../shared/businessDay.js';
import { printedByLine } from '../../shared/printedBy';

// Payroll report: approved and paid runs over a range, one row per employee -
// earned (taxable and not), absences, each deduction, take-home, and what the
// employer paid on top. Prints with who printed it, or downloads for Excel.
const COLS = [
  ['grossPay', 'Gross'], ['taxableIncome', 'Taxable'], ['nonTaxablePay', 'Non-taxable'], ['absenceDeduction', 'Absences'],
  ['sss', 'SSS'], ['philhealth', 'PhilHealth'], ['pagibig', 'Pag-IBIG'], ['withholdingTax', 'Tax'], ['otherDeductions', 'Other'],
  ['netPay', 'Net pay'], ['sssER', 'SSS (employer)'], ['philhealthER', 'PhilHealth (employer)'], ['pagibigER', 'Pag-IBIG (employer)'],
];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export default function PayrollReport({ apiFetch, onClose }) {
  const [start, setStart] = useState(monthStartStr());
  const [end, setEnd] = useState(todayStr());
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    try {
      const d = await (await apiFetch(`/api/payroll/report?start=${start}&end=${end}`)).json();
      if (!d.success) { ui.alert(d.error || 'Could not load the report.'); return; }
      setData(d);
    } catch { ui.alert('Network error.'); } finally { setBusy(false); }
  };

  const print = () => {
    const w = window.open('', '_blank', 'width=1100,height=750');
    if (!w) return ui.alert('Allow pop-ups for this site to print the report.');
    const head = `<tr><th>Employee</th>${COLS.map(([, l]) => `<th class="r">${esc(l)}</th>`).join('')}</tr>`;
    const body = data.rows.map((r) => `<tr><td>${esc(r.employeeName)}${r.tin ? `<br><small>TIN ${esc(r.tin)}</small>` : ''}</td>${COLS.map(([k]) => `<td class="r">${esc(peso(r[k]))}</td>`).join('')}</tr>`).join('');
    const foot = `<tr><th>Total</th>${COLS.map(([k]) => `<th class="r">${esc(peso(data.totals[k]))}</th>`).join('')}</tr>`;
    w.document.write(`<!doctype html><html><head><title>Payroll report ${esc(start)} to ${esc(end)}</title><style>
      body{font-family:Arial,sans-serif;font-size:10px;margin:20px;color:#000}h1{font-size:16px;margin:0 0 4px}p{margin:0 0 10px}
      table{width:100%;border-collapse:collapse}th,td{border:1px solid #999;padding:4px;text-align:left}th{background:#eee}.r{text-align:right;white-space:nowrap}
      small{color:#555}.by{margin-top:14px;font-size:9px;color:#666;text-align:center}@page{size:landscape;margin:10mm}
    </style></head><body><h1>Payroll report</h1><p>${esc(formatDate(start))} to ${esc(formatDate(end))} · ${data.runs.length} run(s) · ${data.rows.length} employee(s)</p>
    <table><thead>${head}</thead><tbody>${body}</tbody><tfoot>${foot}</tfoot></table><p class="by">${esc(printedByLine())}</p></body></html>`);
    w.document.close(); w.focus(); w.print();
  };

  const download = () => {
    // Numbers as numbers; text that a spreadsheet would read as a formula
    // (= + - @ ...) is shown as text.
    const q = (v) => (typeof v === 'number' ? String(v)
      : `"${String(v ?? '').replace(/^([=+\-@\t\r])/, "'$1").replace(/"/g, '""')}"`);
    const lines = [['Employee', 'TIN', 'Runs', ...COLS.map(([, l]) => l)].map(q).join(',')];
    for (const r of data.rows) lines.push([r.employeeName, r.tin, r.runs, ...COLS.map(([k]) => r[k])].map(q).join(','));
    lines.push(['Total', '', '', ...COLS.map(([k]) => data.totals[k])].map(q).join(','));
    const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `payroll-report-${start}-to-${end}.csv` });
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const input = 'bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-sm text-fg';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-label="Payroll report" className="bg-sidebar-bg border border-white/10 rounded-2xl shadow-2xl w-full max-w-6xl p-6 max-h-[90vh] overflow-y-auto space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-black text-fg text-lg">Payroll report</h2>
            <p className="text-xs text-fg/70">Approved and paid runs, per employee. Drafts are not counted.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-fg/70 hover:text-fg"><X size={18} /></button>
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <label className="text-[10px] font-bold uppercase tracking-wider text-fg/70">From<input type="date" value={start} onChange={e => setStart(e.target.value)} className={`${input} block mt-1`} /></label>
          <label className="text-[10px] font-bold uppercase tracking-wider text-fg/70">To<input type="date" value={end} onChange={e => setEnd(e.target.value)} className={`${input} block mt-1`} /></label>
          <button onClick={load} disabled={busy} className="px-4 py-2 rounded-lg bg-brand text-on-brand text-xs font-bold uppercase tracking-wider disabled:opacity-50">{busy ? 'Loading…' : 'Show'}</button>
          {data?.rows?.length > 0 && (<>
            <button onClick={print} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/15 text-xs font-bold text-fg/80"><Printer size={13} /> Print</button>
            <button onClick={download} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/15 text-xs font-bold text-fg/80"><Download size={13} /> Excel (CSV)</button>
          </>)}
        </div>
        {data && (data.rows.length === 0 ? (
          <p className="text-sm text-fg/70 py-6 text-center">No approved or paid payroll in that range.</p>
        ) : (
          <div className="overflow-x-auto border border-white/10 rounded-lg">
            <table className="w-full text-xs min-w-[1100px]">
              <thead><tr className="text-[9px] font-black uppercase tracking-widest text-fg/70 border-b border-white/10">
                <th className="text-left px-3 py-2">Employee</th>
                {COLS.map(([k, l]) => <th key={k} className="text-right px-3 py-2">{l}</th>)}
              </tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.employeeName} className="border-b border-white/5">
                    <td className="px-3 py-2 font-bold text-fg">{r.employeeName}{r.tin && <span className="block text-[10px] font-normal text-fg/60">TIN {r.tin}</span>}</td>
                    {COLS.map(([k]) => <td key={k} className={`px-3 py-2 text-right tabular-nums ${k === 'netPay' ? 'font-bold text-fg' : 'text-fg/80'}`}>{peso(r[k])}</td>)}
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="border-t border-white/10">
                <td className="px-3 py-2 font-black text-fg uppercase text-[10px]">Total</td>
                {COLS.map(([k]) => <td key={k} className="px-3 py-2 text-right tabular-nums font-black text-fg">{peso(data.totals[k])}</td>)}
              </tr></tfoot>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
