import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, AlertTriangle, AlertCircle, Info, RefreshCw } from 'lucide-react';
import { useDashboard } from '../dashboard/DashboardContext';

// Header bell: one collapsible panel aggregating everything that needs
// attention, with every row clickable straight through to the offending record.
//
// The whole point is that an alert nobody navigates to is an alert nobody acts
// on — so each item carries `tab`/`sub`/`focusId` from the server and this
// component turns that into a real jump.

const SEVERITY = {
  critical: { Icon: AlertCircle,    dot: 'bg-red-500',    text: 'text-red-400',    ring: 'border-red-500/30' },
  warn:     { Icon: AlertTriangle,  dot: 'bg-yellow-500', text: 'text-yellow-400', ring: 'border-yellow-500/30' },
  info:     { Icon: Info,           dot: 'bg-brand',      text: 'text-brand',      ring: 'border-brand/30' },
};

// How often to refresh while the tab is open. Deliberately slow — none of these
// signals change second-to-second, and the POS tablet has better things to do.
const POLL_MS = 120000;

export default function NotificationBell() {
  const { apiFetch, setActiveTab, setLedgerSubTab } = useDashboard();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ items: [], count: 0, criticalCount: 0 });
  const [loading, setLoading] = useState(false);
  const panelRef = useRef(null);
  const btnRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/notifications');
      const d = await res.json();
      if (d?.success) setData({ items: d.items || [], count: d.count || 0, criticalCount: d.criticalCount || 0 });
    } catch {
      // A failed poll is not worth a toast — the bell simply keeps its last
      // known state and tries again on the next tick.
    } finally { setLoading(false); }
  }, [apiFetch]);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  // Close on outside click and on Esc.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (panelRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open]);

  const go = (item) => {
    setOpen(false);
    if (item.sub && setLedgerSubTab) setLedgerSubTab(item.sub);
    if (item.tab) setActiveTab(item.tab);
    // Let the target tab mount before asking the browser to scroll to the row.
    if (item.focusId) {
      setTimeout(() => {
        const el = document.querySelector(`[data-notif-id="${item.focusId}"]`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('ring-2', 'ring-brand');
          setTimeout(() => el.classList.remove('ring-2', 'ring-brand'), 2500);
        }
      }, 350);
    }
  };

  const count = data.count;
  const badge = count > 99 ? '99+' : String(count);

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={() => { setOpen(o => !o); if (!open) load(); }}
        aria-label={count ? `Notifications: ${count} item(s) need attention` : 'Notifications: nothing needs attention'}
        aria-expanded={open}
        className={`relative flex items-center gap-1.5 px-3 py-2 rounded-xl font-bold text-xs border transition ${
          data.criticalCount > 0
            ? 'bg-red-500/15 text-red-400 border-red-500/30 hover:bg-red-500/25'
            : count > 0
              ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/25 hover:bg-yellow-500/20'
              : 'bg-white/5 text-fg/50 border-white/10 hover:bg-white/10'
        }`}
      >
        <Bell size={13} />
        {count > 0 && (
          <span className={`min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-black flex items-center justify-center text-fg ${
            data.criticalCount > 0 ? 'bg-red-500' : 'bg-yellow-500'
          }`}>
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 mt-2 w-[min(92vw,26rem)] max-h-[70vh] overflow-hidden flex flex-col bg-surface border border-white/10 rounded-2xl shadow-elev-3 z-[9999] animate-scale-in"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
            <div>
              <h3 className="text-fg font-black text-sm uppercase tracking-wider">Needs Attention</h3>
              <p className="text-fg/30 text-[10px] font-bold uppercase tracking-widest mt-0.5">
                {count === 0 ? 'All clear' : `${count} item${count === 1 ? '' : 's'}`}
                {data.criticalCount > 0 && ` · ${data.criticalCount} critical`}
              </p>
            </div>
            <button
              onClick={load}
              disabled={loading}
              aria-label="Refresh notifications"
              className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 text-fg/40 hover:text-fg flex items-center justify-center transition disabled:opacity-40"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {count === 0 ? (
              <div className="px-4 py-10 text-center">
                <p className="text-fg/40 text-sm font-bold">Nothing needs attention</p>
                <p className="text-fg/20 text-xs mt-1">Stock, expiry, A/R and POs all look fine.</p>
              </div>
            ) : (
              data.items.map((item) => {
                const s = SEVERITY[item.severity] || SEVERITY.info;
                return (
                  <button
                    key={item.id}
                    onClick={() => go(item)}
                    className="w-full text-left flex items-start gap-3 px-4 py-3 border-b border-white/5 hover:bg-white/5 transition group"
                  >
                    <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${s.dot}`} />
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm font-bold ${s.text} break-words`}>{item.title}</span>
                      {item.detail && (
                        <span className="block text-fg/40 text-xs mt-0.5 break-words">{item.detail}</span>
                      )}
                    </span>
                    <span className="text-fg/20 group-hover:text-fg/50 text-xs font-black shrink-0 mt-0.5">›</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
