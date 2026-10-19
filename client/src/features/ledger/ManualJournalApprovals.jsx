import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle, XCircle, ChevronDown, ChevronUp } from 'lucide-react';
import * as ui from '../../shared/ui';
import Attachments from '../../shared/Attachments';

// Manual journal entries waiting for an approver. Everyone who can see the
// books sees what is waiting (and whose it is); only someone holding
// "Approve manual journal entries" gets the Post / Reject buttons.
export default function ManualJournalApprovals({ apiFetch, can, peso, onPosted, refreshKey = 0, activeAdmin, isSuperAdmin }) {
  const [drafts, setDrafts] = useState(null);
  const [open, setOpen] = useState({});
  const [busy, setBusy] = useState('');
  const canApprove = can('journal.approve');

  const load = useCallback(async () => {
    try {
      const d = await (await apiFetch('/api/journal/drafts?status=Pending')).json();
      setDrafts(d.success ? d.drafts : []);
    } catch { setDrafts([]); }
  }, [apiFetch]);
  useEffect(() => { load(); }, [load, refreshKey]);

  const act = async (draft, action) => {
    let body = {};
    if (action === 'reject') {
      const reason = prompt(`Reject ${draft.draftNumber}? Tell ${draft.preparedBy || 'the preparer'} why:`);
      if (!reason || !reason.trim()) return;
      body = { reason: reason.trim() };
    } else if (!(await ui.confirm(`Post ${draft.draftNumber} (${peso(draft.totalDebit)}) to the ledger?`))) return;
    setBusy(draft._id);
    try {
      const d = await (await apiFetch(`/api/journal/drafts/${draft._id}/${action}`, { method: 'POST', body: JSON.stringify(body) })).json();
      if (!d.success) return ui.alert(d.error || 'Action failed.');
      ui.toast(action === 'approve' ? `Posted as ${d.entry?.reference}.` : 'Rejected - the preparer can see why.', { tone: 'success' });
      load();
      if (action === 'approve') onPosted?.();
    } catch { ui.alert('Network error.'); }
    finally { setBusy(''); }
  };

  if (!drafts || drafts.length === 0) return null;
  return (
    <div className="bg-surface border border-amber-500/30 rounded-xl p-4 mb-4">
      <h3 className="text-sm font-black text-fg mb-1">Waiting for approval ({drafts.length})</h3>
      <p className="text-[11px] text-fg/70 mb-3">Manual journal entries post to the ledger only once an approver signs off.</p>
      <ul className="space-y-2">
        {drafts.map(d => (
          <li key={d._id} className="bg-white/5 border border-white/10 rounded-lg p-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-xs font-bold text-fg">{d.draftNumber} · {peso(d.totalDebit)}</p>
                <p className="text-[11px] text-fg/75 truncate" title={d.description}>{d.description || '(no description)'}</p>
                <p className="text-[10px] text-fg/65">Prepared by {d.preparedBy} · {new Date(d.createdAt).toLocaleString()}{d.date ? ` · dated ${String(d.date).slice(0, 10)}` : ''}</p>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <button type="button" onClick={() => setOpen(o => ({ ...o, [d._id]: !o[d._id] }))} className="px-2 py-1 rounded-lg bg-white/5 text-fg/80 text-[11px] font-bold flex items-center gap-1">
                  Lines {open[d._id] ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                </button>
                {canApprove && <>
                  <button type="button" disabled={busy === d._id} onClick={() => act(d, 'approve')} className="px-2.5 py-1 rounded-lg bg-green-500/15 text-success text-[11px] font-bold flex items-center gap-1 disabled:opacity-50"><CheckCircle size={11} /> Post</button>
                  <button type="button" disabled={busy === d._id} onClick={() => act(d, 'reject')} className="px-2.5 py-1 rounded-lg bg-red-500/10 text-danger text-[11px] font-bold flex items-center gap-1 disabled:opacity-50"><XCircle size={11} /> Reject</button>
                </>}
              </div>
            </div>
            {open[d._id] && (
              <>
                <table className="w-full text-[11px] mt-2">
                  <thead className="text-fg/65"><tr><th className="text-left font-bold">Account</th><th className="text-right font-bold">Debit</th><th className="text-right font-bold">Credit</th></tr></thead>
                  <tbody>
                    {d.lines.map((l, i) => (
                      <tr key={i} className="border-t border-white/5">
                        <td className="py-1 text-fg">{l.accountCode} {l.accountName}</td>
                        <td className="py-1 text-right tabular-nums text-fg">{l.debit ? peso(l.debit) : ''}</td>
                        <td className="py-1 text-right tabular-nums text-fg">{l.credit ? peso(l.credit) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Attachments entity="ManualJournal" entityId={d._id} apiFetch={apiFetch}
                  canAttach={can('accounting.manage')} currentUserId={activeAdmin?._id} isSuperAdmin={isSuperAdmin} title="Supporting documents" />
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
