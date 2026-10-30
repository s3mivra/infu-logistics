import LoadingRows from '../../shared/LoadingRows';
import { useCallback, useEffect, useState } from 'react';
import { formatPeso } from '../../shared/money.js';
import { RefreshCw, AlertTriangle, CheckCircle } from 'lucide-react';
import { todayStr } from '../../shared/businessDay.js';

// The end-of-day check on one screen: what was sold and how it was paid, what
// each drawer was counted at against what it should have held, and what went
// to the bank - so a difference is caught the same day, not at month end.
const peso = formatPeso;
const Row = ({ label, value, tone = 'text-fg/80', strong = false }) => (
  <div className="flex items-baseline justify-between gap-3 py-1.5 border-t border-white/5 first:border-0 text-sm">
    <span className="text-fg/70">{label}</span>
    <span className={`tabular-nums ${strong ? 'font-black' : 'font-bold'} ${tone}`}>{value}</span>
  </div>
);

export default function DailyClosingCheck({ apiFetch }) {
  const [date, setDate] = useState(() => todayStr());
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await (await apiFetch(`/api/reports/daily-closing?date=${date}`)).json();
      setD(r.success ? r : { error: r.error || 'Could not load the closing check.' });
    } catch { setD({ error: 'Network error.' }); }
    finally { setLoading(false); }
  }, [apiFetch, date]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs font-bold text-fg/70 uppercase tracking-wider">
          Day
          <input type="date" value={date} max={todayStr()} onChange={e => e.target.value && setDate(e.target.value)}
            className="bg-surface border border-white/10 rounded-xl px-3 py-2 text-fg text-sm outline-none focus:border-brand/50 normal-case" />
        </label>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-fg/80 px-3 py-2 rounded-xl font-bold text-xs uppercase tracking-wider transition disabled:opacity-40">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {!d ? <LoadingRows />
        : d.error ? <p className="text-danger text-sm font-bold p-6 text-center">{d.error}</p>
        : (<>
          <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${d.issues.length ? 'bg-amber-500/10 border-amber-500/30' : 'bg-green-900/20 border-green-500/30'}`}>
            {d.issues.length ? <AlertTriangle size={16} className="text-warning shrink-0 mt-0.5" /> : <CheckCircle size={16} className="text-success shrink-0 mt-0.5" />}
            <div className="text-sm">
              {d.issues.length === 0
                ? <p className="font-bold text-success">Nothing to check for this day{d.sales.count === 0 ? ' - there were no sales.' : '.'}</p>
                : <ul className="space-y-0.5">{d.issues.map(i => <li key={i} className="font-bold text-warning">{i}</li>)}</ul>}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-surface border border-white/10 rounded-xl p-4">
              <h4 className="text-[11px] font-black uppercase tracking-widest text-fg/70 mb-2">Sold</h4>
              <p className="text-2xl font-black text-brand-text tabular-nums">{peso(d.sales.total)}</p>
              <p className="text-fg/70 text-xs mb-2">{d.sales.count} completed sale(s)</p>
              {Object.entries(d.sales.byMethod).sort((a, b) => b[1] - a[1]).map(([m, v]) => <Row key={m} label={m} value={peso(v)} />)}
              {d.sales.count === 0 && <p className="text-fg/65 text-xs">No sales on this day.</p>}
            </div>

            <div className="bg-surface border border-white/10 rounded-xl p-4">
              <h4 className="text-[11px] font-black uppercase tracking-widest text-fg/70 mb-2">Drawer</h4>
              <p className="text-2xl font-black text-fg tabular-nums">{peso(d.totals.counted)}</p>
              <p className="text-fg/70 text-xs mb-2">counted when closed</p>
              <Row label="Cash sales" value={peso(d.sales.cash)} />
              <Row label="Starting cash" value={peso(d.totals.floats)} />
              <Row label="Over / short" value={`${d.totals.variance > 0 ? '+' : ''}${peso(d.totals.variance)}`}
                tone={Math.abs(d.totals.variance) < 0.005 ? 'text-success' : 'text-danger'} strong />
            </div>

            <div className="bg-surface border border-white/10 rounded-xl p-4">
              <h4 className="text-[11px] font-black uppercase tracking-widest text-fg/70 mb-2">To the bank</h4>
              <p className="text-2xl font-black text-fg tabular-nums">{peso(d.totals.deposited)}</p>
              <p className="text-fg/70 text-xs mb-2">in {d.deposits.length} deposit(s)</p>
              <Row label="Left in the drawer" value={peso(d.totals.leftInDrawer)} />
              {d.deposits.map(x => <Row key={x._id} label={`${x.reference || 'Deposit'}${x.by ? ` · ${x.by}` : ''}`} value={peso(x.amount)} />)}
            </div>
          </div>

          {d.drawers.length > 0 && (
            <div className="bg-surface border border-white/10 rounded-xl p-4">
              <h4 className="text-[11px] font-black uppercase tracking-widest text-fg/70 mb-2">Each drawer session</h4>
              <div className="space-y-2">
                {d.drawers.map(s => (
                  <div key={s._id} className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-xs border-t border-white/5 first:border-0 pt-2 first:pt-0">
                    <span className="font-black text-fg text-sm flex-1 basis-[8rem]">{s.cashier || 'Cashier'}
                      <span className={`ml-2 text-[10px] font-black uppercase px-1.5 py-0.5 rounded ${s.status === 'Open' ? 'bg-amber-500/20 text-warning' : 'bg-white/10 text-fg/75'}`}>{s.status}</span>
                    </span>
                    <span className="text-fg/70">Should hold <b className="text-fg tabular-nums">{s.expected == null ? '-' : peso(s.expected)}</b></span>
                    <span className="text-fg/70">Counted <b className="text-fg tabular-nums">{s.counted == null ? '-' : peso(s.counted)}</b></span>
                    <span className={`font-black tabular-nums ${s.variance == null ? 'text-fg/65' : Math.abs(s.variance) < 0.005 ? 'text-success' : 'text-danger'}`}>
                      {s.variance == null ? 'not counted' : Math.abs(s.variance) < 0.005 ? 'exact' : `${s.variance > 0 ? 'over' : 'short'} ${peso(Math.abs(s.variance))}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>)}
    </div>
  );
}
