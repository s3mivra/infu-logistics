import { useCallback, useEffect, useState } from 'react';
import { ClipboardCheck, ShoppingCart, Wallet, Receipt, Check, X, Loader2, Lock } from 'lucide-react';
import { useDashboard } from '../dashboard/DashboardContext';

// Single inbox for everything awaiting an accounting.manage/superadmin
// approval: PO requisitions, revolving-fund disbursement requisitions, and
// AP bills. Each type already has its own approve/reject route (requisitions.js
// / bills.js) - this tab just aggregates the Pending queues from all three so
// nobody has to go hunting through Procurement, Ledger > Revolving Funds, and
// Ledger > Bills separately to find what needs a decision.
//
// Gated both here (belt) and on every route it calls (suspenders) - the server
// enforces accounting.manage/superadmin independently of what this tab shows.

const fmtDate = (d) => d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '-';

export default function ApprovalsTab() {
  const { apiFetch, can, isSuperAdmin, bills, fetchBills, approveBill, rejectBill, billBusy } = useDashboard();
  const canApprove = isSuperAdmin || can('accounting.manage');

  const [requisitions, setRequisitions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [decidingId, setDecidingId] = useState(null);

  const fetchRequisitions = useCallback(async () => {
    try {
      const res = await apiFetch('/api/requisitions?status=Pending&limit=200');
      const d = await res.json();
      if (d.success) setRequisitions(d.requisitions || []);
      else setError(d.error || 'Failed to load requisitions.');
    } catch { setError('Network error loading requisitions.'); }
  }, [apiFetch]);

  const refresh = async () => {
    setLoading(true); setError('');
    await Promise.all([fetchRequisitions(), fetchBills('Pending')]);
    setLoading(false);
  };

  // Deliberately fires once per mount/permission-change only, not on every
  // parent re-render: fetchBills is one of AdminDashboard's ~200 unmemoized
  // handlers, defined fresh on every render (and it calls setBills, which
  // itself forces one of those re-renders) - including it in this effect's
  // deps turns "fetch on open" into an infinite fetch loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (canApprove) refresh(); }, [canApprove]);

  const approveRequisition = async (r) => {
    setDecidingId(r._id); setError('');
    try {
      const res = await apiFetch(`/api/requisitions/${r._id}/approve`, { method: 'POST' });
      const d = await res.json();
      if (d.success) await fetchRequisitions();
      else setError(d.error || 'Failed to approve.');
    } catch { setError('Network error approving requisition.'); }
    finally { setDecidingId(null); }
  };
  const rejectRequisition = async (r) => {
    const reason = prompt(`Reject requisition ${r.reqNumber}? Enter a reason:`);
    if (!reason || !reason.trim()) return;
    setDecidingId(r._id); setError('');
    try {
      const res = await apiFetch(`/api/requisitions/${r._id}/reject`, { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) });
      const d = await res.json();
      if (d.success) await fetchRequisitions();
      else setError(d.error || 'Failed to reject.');
    } catch { setError('Network error rejecting requisition.'); }
    finally { setDecidingId(null); }
  };

  const pendingBills = (bills || []).filter(b => b.status === 'Pending');
  const totalPending = requisitions.length + pendingBills.length;

  if (!canApprove) {
    return (
      <div className="p-4 sm:p-6 max-w-3xl mx-auto text-center py-20">
        <Lock size={32} className="mx-auto mb-3 text-fg/20" />
        <p className="text-fg/60 font-bold">You don't have permission to view approvals.</p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-xl bg-brand/15 border border-brand/30 flex items-center justify-center">
          <ClipboardCheck size={19} className="text-brand" />
        </div>
        <div>
          <h1 className="text-xl font-black text-fg leading-none">Approvals</h1>
          <p className="text-fg/40 text-xs font-bold mt-1">
            {loading ? 'Loading…' : totalPending === 0 ? 'Nothing awaiting approval' : `${totalPending} item${totalPending === 1 ? '' : 's'} awaiting approval`}
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-500 border border-red-500 text-white text-sm font-bold px-4 py-3 rounded-xl mb-4">
          {error}
          <button onClick={() => setError('')} className="ml-auto text-white hover:text-red-300"><X size={15} /></button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 text-fg/40 py-16 font-bold"><Loader2 size={18} className="animate-spin" /> Loading…</div>
      ) : totalPending === 0 ? (
        <div className="text-center py-16 text-fg/40 font-bold">
          <ClipboardCheck size={32} className="mx-auto mb-3 opacity-40" />
          All clear - nothing needs a decision right now.
        </div>
      ) : (
        <div className="space-y-2">
          {requisitions.map(r => {
            const isPo = r.type === 'purchase_order';
            const Icon = isPo ? ShoppingCart : Wallet;
            const amount = isPo
              ? (r.poPayload?.lines || []).reduce((s, l) => s + (Number(l.orderedQty) || 0) * (Number(l.unitCost) || 0), 0)
              : Number(r.amount) || 0;
            const title = isPo
              ? `Purchase Order - ${r.poPayload?.supplier || 'No supplier'}`
              : `Fund Disbursement - ${r.description || ''}`;
            const detail = isPo
              ? `${r.poPayload?.lines?.length || 0} item(s)`
              : 'Revolving fund';
            return (
              <div key={r._id} className="bg-white/5 border border-white/10 rounded-2xl px-4 py-3.5 flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-brand/15 border border-brand/30 flex items-center justify-center shrink-0">
                  <Icon size={15} className="text-brand" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-black text-fg text-sm">{r.reqNumber}</span>
                    <span className="inline-flex items-center text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border bg-amber-500 text-white border-amber-500">Pending</span>
                  </div>
                  <p className="text-fg/70 text-xs font-bold mt-0.5 truncate">{title}</p>
                  <p className="text-fg/40 text-xs mt-0.5 truncate">{detail} · Requested by {r.requestedBy || '-'} · {fmtDate(r.requestedAt)}</p>
                </div>
                <span className="text-fg/60 font-black text-sm whitespace-nowrap shrink-0">₱{amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => approveRequisition(r)} disabled={decidingId === r._id}
                    className="flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-green-500 text-white hover:bg-green-500/80 transition disabled:opacity-50">
                    {decidingId === r._id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Approve
                  </button>
                  <button onClick={() => rejectRequisition(r)} disabled={decidingId === r._id}
                    className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-white/5 text-red-300/80 hover:bg-red-500/15 transition disabled:opacity-50">
                    Reject
                  </button>
                </div>
              </div>
            );
          })}

          {pendingBills.map(b => (
            <div key={b._id} className="bg-white/5 border border-white/10 rounded-2xl px-4 py-3.5 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-brand/15 border border-brand/30 flex items-center justify-center shrink-0">
                <Receipt size={15} className="text-brand" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-black text-fg text-sm">{b.billNumber}</span>
                  <span className="inline-flex items-center text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border bg-amber-500 text-white border-amber-500">Pending</span>
                </div>
                <p className="text-fg/70 text-xs font-bold mt-0.5 truncate">Bill - {b.supplierName || b.description || ''}</p>
                <p className="text-fg/40 text-xs mt-0.5 truncate">{b.description} · Due {fmtDate(b.dueDate)}</p>
              </div>
              <span className="text-fg/60 font-black text-sm whitespace-nowrap shrink-0">₱{(Number(b.amount) || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              <div className="flex items-center gap-1.5 shrink-0">
                <button onClick={() => approveBill(b)} disabled={billBusy}
                  className="flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-green-500 text-white hover:bg-green-500/80 transition disabled:opacity-50">
                  <Check size={12} /> Approve
                </button>
                <button onClick={() => rejectBill(b)} disabled={billBusy}
                  className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-white/5 text-red-300/80 hover:bg-red-500/15 transition disabled:opacity-50">
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
