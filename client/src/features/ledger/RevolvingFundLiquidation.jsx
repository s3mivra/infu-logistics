import { useCallback, useEffect, useState } from 'react';
import { CheckCircle, XCircle, Download, RefreshCw } from 'lucide-react';
import * as ui from '../../shared/ui';
import * as auth from '../auth/auth';
import { dateStr, todayStr } from '../../shared/businessDay.js';

// The revolving-fund liquidation report, laid out like the sheet the office
// fills in by hand, with the validation step in front of replenishment:
// each spend is checked against its receipt (Validate / Reject) and the fund
// cannot be topped up until none is left unchecked.
const peso = (n) => `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const weekAgo = () => { const d = new Date(); d.setDate(d.getDate() - 6); return dateStr(d); };
const TONE = {
  Unvalidated: 'bg-amber-400 text-black',
  Validated: 'bg-green-700 text-white',
  Rejected: 'bg-red-700 text-white',
};

export default function RevolvingFundLiquidation({ apiFetch, fund, onChanged }) {
  const [range, setRange] = useState(() => ({ start: weekAgo(), end: todayStr() }));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [rejecting, setRejecting] = useState(null);   // { id, reason }
  const canValidate = auth.can('accounting.manage');
  const me = auth.decodeToken()?.name;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiFetch(`/api/revolving-funds/${fund._id}/liquidation?start=${range.start}&end=${range.end}`);
      const d = await r.json();
      setData(d.success ? d : { error: d.error || 'Could not load the report.' });
    } catch { setData({ error: 'Network error.' }); }
    finally { setLoading(false); }
  }, [apiFetch, fund._id, range.start, range.end]);
  useEffect(() => { load(); }, [load]);

  const decide = async (row, action, reason) => {
    const body = action === 'reject' ? { reason } : {};
    setBusyId(row._id);
    try {
      const r = await apiFetch(`/api/revolving-funds/${fund._id}/transactions/${row._id}/${action}`, { method: 'POST', body: JSON.stringify(body) });
      const d = await r.json();
      if (!d.success) ui.alert(d.error || 'Could not save.');
      else setRejecting(null);
      await load();
      onChanged?.();
    } catch { ui.alert('Network error.'); }
    finally { setBusyId(null); }
  };

  // Excel in the same shape as the hand-kept liquidation sheet.
  const exportXlsx = async () => {
    if (!data?.rows) return;
    const XLSX = await import('xlsx');
    const aoa = [
      ['REVOLVING FUND - LIQUIDATION REPORT'],
      [fund.name],
      ['Date Prepared:', todayStr()],
      ['Covering Date:', `${range.start} to ${range.end}`],
      [],
      ['DATE', 'REF. NO.', 'PAYEE', 'ACCOUNT', 'PARTICULARS', 'AMOUNT', '% of Remaining Funds', 'REVOLVING FUND', 'STATUS'],
      ['', '', '', '', '', '', '', data.fund.float, ''],
      ...data.rows.map(r => [dateStr(new Date(r.date)), r.refNo, r.payee, r.account, r.particulars, r.amount, r.pctRemaining, r.runningBalance, r.status]),
      [],
      ['', '', '', '', 'Total spent', data.totals.spent],
      ['', '', '', '', 'Total Amount of Replenishment', data.totals.toReplenish],
      [],
      ['Prepared By:', '', 'Checked By:', '', 'Approved By:'],
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 28 }, { wch: 34 }, { wch: 36 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 12 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Liquidation');
    XLSX.writeFile(wb, `Liquidation_${fund.name.replace(/[^\w]+/g, '_')}_${range.start}_${range.end}.xlsx`);
  };

  const t = data?.totals;
  return (
    <div className="bg-surface border border-white/10 rounded-2xl overflow-hidden">
      <div className="flex flex-wrap items-end gap-3 px-6 py-4 border-b border-white/10">
        <div className="mr-auto">
          <h4 className="text-fg font-black text-lg">Liquidation Report</h4>
          <p className="text-fg/70 text-xs">Check each spend against its receipt. The fund is topped up only once none is left unchecked.</p>
        </div>
        <label className="text-[10px] text-fg/70 font-bold uppercase">From
          <input type="date" value={range.start} onChange={e => setRange(r => ({ ...r, start: e.target.value }))}
            className="block mt-1 bg-page-bg border border-white/10 rounded-lg px-2 py-1.5 text-fg text-xs" />
        </label>
        <label className="text-[10px] text-fg/70 font-bold uppercase">To
          <input type="date" value={range.end} onChange={e => setRange(r => ({ ...r, end: e.target.value }))}
            className="block mt-1 bg-page-bg border border-white/10 rounded-lg px-2 py-1.5 text-fg text-xs" />
        </label>
        <button onClick={load} title="Refresh" aria-label="Refresh"
          className="h-9 w-9 rounded-lg bg-white/5 hover:bg-white/10 text-fg/75 flex items-center justify-center"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
        <button onClick={exportXlsx} disabled={!data?.rows?.length}
          className="h-9 px-3 rounded-lg bg-accent text-on-brand text-xs font-bold uppercase tracking-wider inline-flex items-center gap-1.5 disabled:opacity-40"><Download size={13} /> Excel</button>
      </div>

      {data?.error && <p className="px-6 py-4 text-danger text-sm">{data.error}</p>}

      {t && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-6 py-4 border-b border-white/10 text-sm">
          <div><p className="text-[10px] text-fg/70 font-bold uppercase">Spent in period</p><p className="text-fg font-black tabular-nums">{peso(t.spent)}</p></div>
          <div><p className="text-[10px] text-fg/70 font-bold uppercase">Waiting to be checked</p><p className={`font-black tabular-nums ${t.unvalidated > 0 ? 'text-warning' : 'text-fg'}`}>{peso(t.unvalidated)}</p></div>
          <div><p className="text-[10px] text-fg/70 font-bold uppercase">Rejected</p><p className="text-fg font-black tabular-nums">{peso(t.rejected)}</p></div>
          <div><p className="text-[10px] text-fg/70 font-bold uppercase">To replenish</p><p className="text-brand-text font-black tabular-nums">{peso(t.toReplenish)}</p></div>
        </div>
      )}

      {data?.rows && (data.rows.length === 0 ? (
        <p className="px-6 py-8 text-center text-fg/70 text-sm">Nothing was spent from this fund in these dates.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-fg/70 border-b border-white/10">
                <th className="px-3 py-2">Date</th><th className="px-3 py-2">Ref. No.</th><th className="px-3 py-2">Payee</th>
                <th className="px-3 py-2">Account</th><th className="px-3 py-2">Particulars</th>
                <th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2 text-right">% Left</th>
                <th className="px-3 py-2 text-right">Fund</th><th className="px-3 py-2">Status</th><th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {data.rows.map(r => (
                <tr key={r._id} className="border-b border-white/5 align-top">
                  <td className="px-3 py-2 whitespace-nowrap text-fg/80">{dateStr(new Date(r.date))}</td>
                  <td className="px-3 py-2 text-fg/80">{r.refNo || '-'}</td>
                  <td className="px-3 py-2 text-fg">{r.payee || '-'}</td>
                  <td className="px-3 py-2 text-fg/80">{r.account}</td>
                  <td className="px-3 py-2 text-fg">{r.particulars}{r.reason && <span className="block text-danger">Rejected: {r.reason}</span>}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-fg font-bold">{peso(r.amount)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-fg/80">{(r.pctRemaining * 100).toFixed(2)}%</td>
                  <td className="px-3 py-2 text-right tabular-nums text-fg/80">{peso(r.runningBalance)}</td>
                  <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${TONE[r.status] || ''}`}>{r.status}</span>
                    {r.validatedBy && <span className="block text-fg/65 mt-0.5">by {r.validatedBy}</span>}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.status === 'Unvalidated' && canValidate && r.spentBy !== me && (
                      <span className="inline-flex gap-1">
                        <button onClick={() => decide(r, 'validate')} disabled={busyId === r._id}
                          className="h-8 px-2 rounded-lg bg-green-700 text-white text-[11px] font-bold inline-flex items-center gap-1 disabled:opacity-40"><CheckCircle size={12} /> Validate</button>
                        <button onClick={() => setRejecting({ id: r._id, reason: '' })} disabled={busyId === r._id}
                          className="h-8 px-2 rounded-lg border border-red-500/40 text-danger text-[11px] font-bold inline-flex items-center gap-1 disabled:opacity-40"><XCircle size={12} /> Reject</button>
                      </span>
                    )}
                    {rejecting?.id === r._id && (
                      <form className="mt-2 flex flex-col gap-1 min-w-[14rem]" onSubmit={e => { e.preventDefault(); if (rejecting.reason.trim()) decide(r, 'reject', rejecting.reason.trim()); }}>
                        <span className="text-fg/75">{peso(r.amount)} comes off the expense and is owed by {r.spentBy || 'the custodian'}.</span>
                        <input autoFocus value={rejecting.reason} onChange={e => setRejecting({ id: r._id, reason: e.target.value })}
                          placeholder="Why is the receipt not accepted?" aria-label="Reason for rejecting"
                          className="bg-page-bg border border-white/20 rounded-lg px-2 py-1.5 text-fg text-xs" />
                        <span className="flex gap-1">
                          <button type="submit" disabled={!rejecting.reason.trim() || busyId === r._id} className="h-8 px-2 rounded-lg bg-red-700 text-white text-[11px] font-bold disabled:opacity-40">Reject receipt</button>
                          <button type="button" onClick={() => setRejecting(null)} className="h-8 px-2 rounded-lg bg-white/5 text-fg/80 text-[11px] font-bold">Cancel</button>
                        </span>
                      </form>
                    )}
                    {r.status === 'Unvalidated' && r.spentBy === me && <span className="text-fg/65">Someone else checks this</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
