import { useEffect, useRef, useState } from 'react';
import { useDashboard } from '../dashboard/DashboardContext';

// Pending-count pill for the "Approvals" nav item. Self-contained and polling
// on its own timer, same pattern as NotificationBell - so the sidebar can show
// a live count without threading another fetch through AdminDashboard's ctx.
const POLL_MS = 120000;

export default function ApprovalsBadge() {
  const { apiFetch } = useDashboard();
  // apiFetch is one of AdminDashboard's ~200 unmemoized handlers - a new
  // function every render (and the dashboard re-renders roughly every second,
  // e.g. the clock-out countdown). A ref sidesteps that: the effect below
  // reads the latest apiFetch through it without needing apiFetch in its own
  // deps, so the poll interval is set up exactly once instead of being torn
  // down and rebuilt (i.e. re-fetching) on every parent render.
  const apiFetchRef = useRef(apiFetch);
  apiFetchRef.current = apiFetch;
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [reqRes, billRes] = await Promise.all([
          apiFetchRef.current('/api/requisitions?status=Pending&limit=200'),
          apiFetchRef.current('/api/bills?status=Pending'),
        ]);
        const [reqData, billData] = await Promise.all([reqRes.json(), billRes.json()]);
        if (cancelled) return;
        const n = (reqData.success ? (reqData.requisitions || []).length : 0) + (billData.success ? (billData.bills || []).length : 0);
        setCount(n);
      } catch { /* keep last known count */ }
    };
    load();
    const t = setInterval(load, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  if (count === 0) return null;
  return (
    <span className="ml-auto text-[9px] text-fg font-black px-1.5 py-0.5 rounded-full bg-amber-500">{count > 99 ? '99+' : count}</span>
  );
}
