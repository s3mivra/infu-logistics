import { useCallback, useEffect, useState } from 'react';
import { Receipt, RefreshCw, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { useDashboard } from '../dashboard/DashboardContext';
import * as ui from '../../shared/ui';

// Withholding tax - money deducted from someone else's payment and held.
//
// This screen answers one question: how much have we withheld that we have not
// yet paid over to the BIR. That figure is a liability, not income, and it is
// the first thing an auditor asks about. Each withholding is listed underneath
// so a 2307 can be filled in per supplier.

const peso = (n) => `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const shortDate = (d) => (d ? new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : '-');
const monthName = (ym) => {
  const [y, m] = String(ym || '').split('-');
  if (!y || !m) return ym;
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-PH', { year: 'numeric', month: 'long' });
};

export default function WithholdingTaxTab() {
  const { apiFetch } = useDashboard();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [range, setRange] = useState({ start: '', end: '' });
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (range.start) qs.set('start', range.start);
      if (range.end) qs.set('end', range.end);
      const d = await (await apiFetch(`/api/reports/withholding-tax${qs.toString() ? `?${qs}` : ''}`)).json();
      if (d.success) setData(d);
      else ui.alert(d.error || 'Could not load the withholding report.');
    } catch { /* keep the last good view */ }
    finally { setLoading(false); }
  }, [apiFetch, range.start, range.end]);

  useEffect(() => { load(); }, [load]);

  const t = data?.totals || { withheld: 0, remitted: 0, outstanding: 0 };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="flex items-center gap-2 font-black text-fg text-lg mr-auto">
          <Receipt size={18} /> Withholding Tax
        </h1>
        <input type="date" value={range.start} onChange={e => setRange(r => ({ ...r, start: e.target.value }))}
          className="bg-sidebar-bg border border-white/10 rounded-lg px-3 py-2 text-xs text-fg focus:border-brand/50 focus:outline-none" />
        <span className="text-fg/30 text-xs">to</span>
        <input type="date" value={range.end} onChange={e => setRange(r => ({ ...r, end: e.target.value }))}
          className="bg-sidebar-bg border border-white/10 rounded-lg px-3 py-2 text-xs text-fg focus:border-brand/50 focus:outline-none" />
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 text-[10px] border border-white/15 text-fg/70 hover:text-fg hover:bg-white/5 px-3 py-2 rounded-lg font-bold uppercase tracking-wider transition disabled:opacity-40">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <p className="text-xs text-fg/50 leading-relaxed max-w-3xl">
        Tax deducted from a supplier's payment is never the business's own expense - the supplier was paid
        less by exactly this much. It sits as a liability from the moment it is withheld until the BIR is
        paid. Set the rate on an expense when you file it.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {[
          ['Withheld', peso(t.withheld), 'text-fg'],
          ['Remitted', peso(t.remitted), 'text-fg/60'],
          ['Still owed to the BIR', peso(t.outstanding), t.outstanding > 0 ? 'text-amber-400' : 'text-green-400'],
        ].map(([label, val, cls]) => (
          <div key={label} className="bg-sidebar-bg border border-white/10 rounded-xl p-3">
            <p className="text-[9px] font-black uppercase tracking-widest text-fg/40">{label}</p>
            <p className={`text-lg font-black tabular-nums ${cls}`}>{val}</p>
          </div>
        ))}
      </div>

      {t.outstanding > 0 && (
        <p className="flex items-start gap-2 text-[11px] text-amber-400/90 bg-amber-400/5 border border-amber-400/20 rounded-xl px-4 py-3">
          <AlertCircle size={13} className="shrink-0 mt-0.5" />
          <span>
            {peso(t.outstanding)} is being held on the BIR's behalf. Record the remittance as a journal
            entry debiting the withholding account and crediting cash - this screen will then show it as
            settled.
          </span>
        </p>
      )}

      <div className="space-y-2">
        {(data?.periods || []).length === 0 && (
          <div className="bg-sidebar-bg border border-white/10 rounded-xl px-4 py-10 text-center text-fg/40 text-sm">
            {loading ? 'Loading…' : 'Nothing has been withheld in this range.'}
          </div>
        )}
        {(data?.periods || []).map(p => {
          const key = `${p.month}:${p.accountCode}`;
          const isOpen = open === key;
          return (
            <div key={key} className="bg-sidebar-bg border border-white/10 rounded-xl overflow-hidden">
              <button onClick={() => setOpen(isOpen ? null : key)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.02] transition">
                {isOpen ? <ChevronDown size={14} className="text-fg/40" /> : <ChevronRight size={14} className="text-fg/40" />}
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-fg text-sm">{monthName(p.month)}</p>
                  <p className="text-[10px] text-fg/40">{p.accountName}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs tabular-nums text-fg">{peso(p.withheld)} withheld</p>
                  <p className={`text-[10px] tabular-nums ${p.outstanding > 0 ? 'text-amber-400' : 'text-green-400'}`}>
                    {p.outstanding > 0 ? `${peso(p.outstanding)} still owed` : 'settled'}
                  </p>
                </div>
              </button>

              {isOpen && (
                <div className="border-t border-white/5">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-[9px] font-black uppercase tracking-widest text-fg/40">
                        <th className="text-left px-4 py-2">Date</th>
                        <th className="text-left px-4 py-2">Reference</th>
                        <th className="text-left px-4 py-2">Description</th>
                        <th className="text-right px-4 py-2">Withheld</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.entries.map((e, i) => (
                        <tr key={i} className="border-t border-white/5">
                          <td className="px-4 py-2 text-fg/60">{shortDate(e.date)}</td>
                          <td className="px-4 py-2 text-fg/80">{e.reference}</td>
                          <td className="px-4 py-2 text-fg/50 truncate max-w-[22rem]">{e.description}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-fg">{peso(e.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="px-4 py-2 text-[10px] text-fg/35 border-t border-white/5">
                    One row per withholding - enough to fill in a 2307 for each supplier.
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
