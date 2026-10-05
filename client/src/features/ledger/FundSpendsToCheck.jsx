import { useCallback, useEffect, useState } from 'react';
import { CheckCircle, XCircle, Wallet } from 'lucide-react';
import * as ui from '../../shared/ui';
import * as auth from '../auth/auth';
import { dateStr } from '../../shared/businessDay.js';

// Money spent out of a revolving fund leaves at once (it can never overdraw
// the fund), then waits for someone else to check it against its receipt.
// That check lives on each fund's liquidation sheet; this lists every spend
// still waiting, across all funds, on the Approvals page - where people look
// for things to approve. Draws nothing when there is none.
const peso = (n) => `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function FundSpendsToCheck({ apiFetch, onChanged }) {
  const [rows, setRows] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [rejecting, setRejecting] = useState(null);   // { id, reason }
  const canValidate = auth.can('accounting.manage');
  const user = auth.decodeToken() || {};
  const isSuper = String(user.role || '').toLowerCase() === 'superadmin';

  const load = useCallback(async () => {
    try {
      const d = await (await apiFetch('/api/revolving-funds/unvalidated')).json();
      setRows(d.success ? d.rows : []);
    } catch { setRows([]); }
  }, [apiFetch]);
  useEffect(() => { load(); }, [load]);

  const decide = async (row, action, reason) => {
    setBusyId(row._id);
    try {
      const r = await apiFetch(`/api/revolving-funds/${row.fundId}/transactions/${row._id}/${action}`, { method: 'POST', body: JSON.stringify(action === 'reject' ? { reason } : {}) });
      const d = await r.json();
      if (!d.success) ui.alert(d.error || 'Could not save.');
      else setRejecting(null);
      await load();
      onChanged?.();
    } catch { ui.alert('Network error.'); }
    finally { setBusyId(null); }
  };

  if (!rows.length) return null;
  return (
    <div className="bg-surface border border-white/10 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-white/5">
        <h4 className="text-sm font-black text-fg flex items-center gap-2"><Wallet size={15} className="text-brand-text" /> Revolving fund spends to check ({rows.length})</h4>
        <p className="text-fg/70 text-xs mt-0.5">Already paid out of the fund. Check each against its receipt - the fund cannot be topped up while any is left unchecked.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs min-w-[720px]">
          <thead className="text-fg/65 text-[10px] font-black uppercase tracking-wider border-b border-white/5">
            <tr>
              <th className="px-4 py-2">Date</th><th className="px-4 py-2">Fund</th><th className="px-4 py-2">Spent by</th>
              <th className="px-4 py-2">Paid to</th><th className="px-4 py-2">For</th>
              <th className="px-4 py-2 text-right">Amount</th><th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const own = r.spentBy && r.spentBy === user.name && !isSuper;
              return (
                <tr key={r._id} className="border-b border-white/5 align-top">
                  <td className="px-4 py-2 whitespace-nowrap text-fg/80">{dateStr(new Date(r.date))}</td>
                  <td className="px-4 py-2 text-fg">{r.fundName}</td>
                  <td className="px-4 py-2 text-fg/80">{r.spentBy || '-'}</td>
                  <td className="px-4 py-2 text-fg/80">{r.payee || '-'}{r.refNo && <span className="block text-fg/65">{r.refNo}</span>}</td>
                  <td className="px-4 py-2 text-fg">{r.description}<span className="block text-fg/65">{r.account}</span></td>
                  <td className="px-4 py-2 text-right tabular-nums text-fg font-bold">{peso(r.amount)}</td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {!canValidate ? <span className="text-fg/65">Waiting to be checked</span>
                      : own ? <span className="text-fg/65">Someone else checks this</span>
                      : (
                        <span className="inline-flex gap-1">
                          <button onClick={() => decide(r, 'validate')} disabled={busyId === r._id}
                            className="h-8 px-2 rounded-lg bg-green-700 text-white text-[11px] font-bold inline-flex items-center gap-1 disabled:opacity-40"><CheckCircle size={12} /> Approve</button>
                          <button onClick={() => setRejecting({ id: r._id, reason: '' })} disabled={busyId === r._id}
                            className="h-8 px-2 rounded-lg border border-red-500/40 text-danger text-[11px] font-bold inline-flex items-center gap-1 disabled:opacity-40"><XCircle size={12} /> Reject</button>
                        </span>
                      )}
                    {rejecting?.id === r._id && (
                      <form className="mt-2 flex flex-col gap-1 min-w-[14rem] whitespace-normal" onSubmit={e => { e.preventDefault(); if (rejecting.reason.trim()) decide(r, 'reject', rejecting.reason.trim()); }}>
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
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
