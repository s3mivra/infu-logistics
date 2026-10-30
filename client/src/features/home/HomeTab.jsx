import LoadingRows from '../../shared/LoadingRows';
import { useEffect, useState, useCallback } from 'react';
import {
  ShoppingCart, Package, Truck, LayoutDashboard, BarChart2, BookOpen, Clock, CalendarDays,
  CheckCircle2, Circle, ChevronRight, RefreshCw, Bell, ClipboardCheck, Wallet,
} from 'lucide-react';

// Home: where each person starts. What waits on them first ("Needs your
// action"), then the setup checklist while the business is new, then the
// screens their role uses most. Built from permissions, so a cashier sees the
// till and their shift, a stock clerk stock and transfers, the owner money.
const SHORTCUTS = [
  { perm: 'orders.view',      tab: 'orders',      label: 'Open the till',      hint: 'Take and manage orders', Icon: ShoppingCart },
  { perm: 'inventory.view',   tab: 'inventory',   label: 'Check stock',        hint: 'Levels, expiry, transfers', Icon: Package },
  { perm: 'procurement.view', tab: 'procurement', label: 'Purchase orders',    hint: 'Buy, receive, suppliers', Icon: Truck },
  { perm: 'owner.view',       tab: 'owner',       label: 'Owner overview',     hint: 'Today at a glance', Icon: LayoutDashboard },
  { perm: 'reports.view',     tab: 'reports', sub: 'arreport', label: 'Who owes you', hint: 'Receivables and collections', Icon: Wallet },
  { perm: 'reports.view',     tab: 'reports',     label: 'Reports',            hint: 'Sales, P&L, balance sheet', Icon: BarChart2 },
  { perm: 'accounting.view',  tab: 'ledger',      label: 'Ledger',             hint: 'Journal, month-end close', Icon: BookOpen },
  { perm: 'shifts.view',      tab: 'history',     label: 'Shifts & cash',      hint: 'Drawer counts, daily closing', Icon: Clock },
  { perm: null,               tab: 'timeoff',     label: 'Leave & overtime',   hint: 'File or check a request', Icon: CalendarDays },
];

export default function HomeTab({ apiFetch, can, go, navigate, user, isSuperAdmin, alerts }) {
  const [actions, setActions] = useState(null);
  const [steps, setSteps] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, s] = await Promise.all([
        apiFetch('/api/action-items').then((r) => r.json()).catch(() => ({})),
        apiFetch('/api/setup-progress').then((r) => r.json()).catch(() => ({})),
      ]);
      setActions(a.success ? a.items : []);
      setSteps(s.success ? s.steps : []);
    } finally { setLoading(false); }
  }, [apiFetch]);
  useEffect(() => { load(); }, [load]);

  const open = (row) => (row.tab === 'admin-panel' ? navigate('/admin/admin-panel') : go(row.tab, row.sub));
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const done = steps.filter((s) => s.done).length;
  const shortcuts = SHORTCUTS.filter((s) => !s.perm || can(s.perm));
  const card = 'bg-surface border border-white/10 rounded-2xl p-5';

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-fg">{greet}{user?.name ? `, ${user.name}` : ''}</h1>
          <p className="text-sm text-fg/70">Here is what needs you today.</p>
        </div>
        <button type="button" onClick={load} disabled={loading} className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold bg-white/5 border border-white/10 text-fg/80 hover:text-fg disabled:opacity-50">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <section className={card} aria-labelledby="home-actions">
        <h2 id="home-actions" className="text-sm font-black uppercase tracking-wider text-fg mb-3 flex items-center gap-2">
          <ClipboardCheck size={16} /> Needs your action
        </h2>
        {actions === null ? <LoadingRows />
          : actions.length === 0 && !(alerts?.criticalCount > 0) ? (
            <p className="text-sm text-fg/75 flex items-center gap-2"><CheckCircle2 size={16} className="text-success" /> Nothing is waiting on you. All clear.</p>
          ) : (
            <ul className="divide-y divide-white/5">
              {actions.map((a) => (
                <li key={a.id}>
                  <button type="button" onClick={() => open(a)} className="w-full flex items-center gap-3 py-3 text-left group">
                    <span className="min-w-[2rem] h-8 px-2 rounded-lg bg-brand/15 text-brand-text font-black text-sm flex items-center justify-center">{a.count}</span>
                    <span className="flex-1 text-sm font-bold text-fg">{a.label}</span>
                    <span className="text-xs font-bold text-brand-text group-hover:underline flex items-center gap-1">Open <ChevronRight size={14} /></span>
                  </button>
                </li>
              ))}
              {alerts?.count > 0 && (
                <li className="py-3 flex items-center gap-3 text-sm text-fg/80">
                  <span className="min-w-[2rem] h-8 px-2 rounded-lg bg-white/5 font-black flex items-center justify-center"><Bell size={14} /></span>
                  <span className="flex-1">{alerts.count} alert(s) in the bell{alerts.criticalCount ? `, ${alerts.criticalCount} urgent` : ''}: stock, expiry, overdue balances.</span>
                </li>
              )}
            </ul>
          )}
      </section>

      {steps.length > 0 && done < steps.length && (
        <section className={card} aria-labelledby="home-setup">
          <div className="flex items-center justify-between gap-3 mb-2">
            <h2 id="home-setup" className="text-sm font-black uppercase tracking-wider text-fg">Getting started</h2>
            <span className="text-xs font-bold text-fg/70">{done} of {steps.length} done</span>
          </div>
          <div className="h-2 rounded-full bg-white/10 mb-4 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done}>
            <div className="h-full bg-brand transition-all" style={{ width: `${(done / steps.length) * 100}%` }} />
          </div>
          <ol className="space-y-1">
            {steps.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => open(s)} disabled={s.tab === 'admin-panel' && !isSuperAdmin}
                  className="w-full flex items-center gap-3 py-2 text-left rounded-lg hover:bg-white/[0.03] px-2 -mx-2">
                  {s.done ? <CheckCircle2 size={18} className="text-success shrink-0" /> : <Circle size={18} className="text-fg/40 shrink-0" />}
                  <span className="flex-1">
                    <span className={`block text-sm font-bold ${s.done ? 'text-fg/60 line-through' : 'text-fg'}`}>{s.label}</span>
                    <span className="block text-[11px] text-fg/65">{s.hint}</span>
                  </span>
                  {!s.done && <ChevronRight size={14} className="text-fg/60" />}
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section aria-labelledby="home-shortcuts">
        <h2 id="home-shortcuts" className="text-sm font-black uppercase tracking-wider text-fg mb-3">Your screens</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {shortcuts.map((s) => (
            <button key={s.label} type="button" onClick={() => go(s.tab, s.sub)}
              className="text-left bg-surface border border-white/10 hover:border-brand/50 rounded-2xl p-4 min-h-[76px] flex items-center gap-3 transition">
              <span className="w-11 h-11 rounded-xl bg-brand/15 text-brand-text flex items-center justify-center shrink-0"><s.Icon size={20} /></span>
              <span>
                <span className="block text-sm font-black text-fg">{s.label}</span>
                <span className="block text-[11px] text-fg/65">{s.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
