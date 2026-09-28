import React, { useCallback, useEffect, useState } from 'react';
import { CalendarDays, Clock, CheckCircle, XCircle, RefreshCw } from 'lucide-react';
import { useDashboard } from '../dashboard/DashboardContext';
import * as ui from '../../shared/ui';

// Leave and overtime. Everyone files their own here; whoever builds the rosters
// (Build & publish staff rosters) sees everyone's and approves or rejects them
// - never their own. Approved days and hours feed payroll's "Fill from
// timesheet".

const LEAVE_TYPES = [
  ['Vacation', 'Vacation (paid)'], ['Sick', 'Sick (paid)'], ['Emergency', 'Emergency (paid)'], ['Unpaid', 'Unpaid'],
];
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const inputCls = 'w-full bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-sm text-fg focus:border-brand/50 focus:outline-none';
const labelCls = 'block text-[9px] font-black uppercase tracking-widest text-fg/70 mb-1';
const TONE = { Pending: 'text-warning bg-amber-400/10', Approved: 'text-success bg-green-400/10', Rejected: 'text-danger bg-red-400/10' };

export default function TimeOffTab() {
  const { apiFetch } = useDashboard();
  const [kind, setKind] = useState('leave');
  const [filter, setFilter] = useState('Pending');
  const [data, setData] = useState({ leave: null, overtime: null, canDecide: false });
  const [busy, setBusy] = useState('');
  const [leave, setLeave] = useState({ type: 'Vacation', from: today(), to: today(), reason: '' });
  const [ot, setOt] = useState({ date: today(), hours: '', reason: '' });
  // A roster manager may file for someone without a device of their own.
  const [forUser, setForUser] = useState('');
  const [staff, setStaff] = useState([]);

  const load = useCallback(async () => {
    const qs = filter === 'All' ? '' : `?status=${filter}`;
    try {
      const [l, o] = await Promise.all([
        apiFetch(`/api/leave-requests${qs}`).then(r => r.json()),
        apiFetch(`/api/overtime-requests${qs}`).then(r => r.json()),
      ]);
      setData({ leave: l.requests || [], overtime: o.requests || [], canDecide: !!(l.canDecide || o.canDecide) });
    } catch { ui.alert('Network error.'); }
  }, [apiFetch, filter]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!data.canDecide || staff.length) return;
    apiFetch('/api/users').then(r => r.json()).then(d => {
      if (d.success) setStaff((d.users || []).filter(u => u.role !== 'client').map(u => ({ id: String(u._id), name: u.name })).sort((a, b) => a.name.localeCompare(b.name)));
    }).catch(() => {});
  }, [data.canDecide, staff.length, apiFetch]);

  const file = async (e) => {
    e.preventDefault();
    const [url, base] = kind === 'leave'
      ? ['/api/leave-requests', leave]
      : ['/api/overtime-requests', { ...ot, hours: Number(ot.hours) }];
    const body = forUser ? { ...base, userId: forUser } : base;
    setBusy('file');
    try {
      const d = await (await apiFetch(url, { method: 'POST', body: JSON.stringify(body) })).json();
      if (!d.success) return ui.alert(d.error || 'Could not file that.');
      ui.toast(kind === 'leave' ? `Leave filed (${d.request.days} day(s)). Waiting for approval.` : 'Overtime filed. Waiting for approval.', { tone: 'success' });
      if (kind === 'leave') setLeave(l => ({ ...l, reason: '' })); else setOt(o => ({ ...o, hours: '', reason: '' }));
      setFilter('Pending'); load();
    } catch { ui.alert('Network error.'); }
    finally { setBusy(''); }
  };

  const decide = async (which, r, decision) => {
    let note = '';
    if (decision === 'reject') {
      note = prompt(`Reject ${r.userName}'s request? Say why:`) || '';
      if (!note.trim()) return;
    }
    setBusy(r._id);
    try {
      const d = await (await apiFetch(`/api/${which}-requests/${r._id}/${decision}`, { method: 'POST', body: JSON.stringify({ note }) })).json();
      if (!d.success) return ui.alert(d.error || 'Could not save that.');
      ui.toast(decision === 'approve' ? 'Approved.' : 'Rejected.', { tone: 'success' });
      load();
    } catch { ui.alert('Network error.'); }
    finally { setBusy(''); }
  };

  const rows = kind === 'leave' ? data.leave : data.overtime;
  const which = kind === 'leave' ? 'leave' : 'overtime';

  return (
    <div className="space-y-5 animate-fade-in max-w-5xl">
      <div>
        <h2 className="text-lg font-black text-fg">Leave & Overtime</h2>
        <p className="text-xs text-fg/70">File your own leave and overtime. {data.canDecide ? 'You approve other people\'s here; your own goes to another roster manager.' : 'A roster manager approves it.'} Approved days and hours are counted when payroll is prepared.</p>
      </div>

      <div className="flex gap-1.5">
        {[['leave', 'Leave', CalendarDays], ['overtime', 'Overtime', Clock]].map(([k, l, Icon]) => (
          <button key={k} type="button" onClick={() => setKind(k)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${kind === k ? 'bg-brand text-on-brand' : 'bg-white/5 text-fg/75 hover:text-fg'}`}><Icon size={13} /> {l}</button>
        ))}
      </div>

      <form onSubmit={file} className="bg-surface border border-white/10 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
        {data.canDecide && staff.length > 0 && (
          <label className="block sm:col-span-4"><span className={labelCls}>For</span>
            <select className={inputCls} value={forUser} onChange={e => setForUser(e.target.value)}>
              <option value="">Myself</option>
              {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        )}
        {kind === 'leave' ? (
          <>
            <label className="block"><span className={labelCls}>Type</span>
              <select className={inputCls} value={leave.type} onChange={e => setLeave(l => ({ ...l, type: e.target.value }))}>
                {LEAVE_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="block"><span className={labelCls}>From</span><input type="date" required className={inputCls} value={leave.from} onChange={e => setLeave(l => ({ ...l, from: e.target.value, to: l.to < e.target.value ? e.target.value : l.to }))} /></label>
            <label className="block"><span className={labelCls}>To</span><input type="date" required min={leave.from} className={inputCls} value={leave.to} onChange={e => setLeave(l => ({ ...l, to: e.target.value }))} /></label>
            <label className="block sm:col-span-4"><span className={labelCls}>Reason</span><input className={inputCls} value={leave.reason} maxLength={300} onChange={e => setLeave(l => ({ ...l, reason: e.target.value }))} placeholder="Optional" /></label>
          </>
        ) : (
          <>
            <label className="block"><span className={labelCls}>Date</span><input type="date" required className={inputCls} value={ot.date} onChange={e => setOt(o => ({ ...o, date: e.target.value }))} /></label>
            <label className="block"><span className={labelCls}>Hours</span><input type="number" required min="0.25" max="16" step="0.25" className={inputCls} value={ot.hours} onChange={e => setOt(o => ({ ...o, hours: e.target.value }))} placeholder="2" /></label>
            <label className="block sm:col-span-2"><span className={labelCls}>What for</span><input className={inputCls} value={ot.reason} maxLength={300} onChange={e => setOt(o => ({ ...o, reason: e.target.value }))} placeholder="e.g. Month-end stock count" /></label>
          </>
        )}
        <div className="sm:col-span-4 flex justify-end">
          <button type="submit" disabled={busy === 'file'} className="px-4 py-2 bg-brand text-on-brand rounded-xl font-bold text-sm hover:bg-brand/90 transition disabled:opacity-50">File {kind === 'leave' ? 'leave' : 'overtime'}</button>
        </div>
      </form>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-1.5 flex-wrap">
          {['Pending', 'Approved', 'Rejected', 'All'].map(s => (
            <button key={s} type="button" onClick={() => setFilter(s)} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${filter === s ? 'bg-brand text-on-brand' : 'bg-white/5 text-fg/75 hover:text-fg'}`}>{s}</button>
          ))}
        </div>
        <button type="button" onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-white/5 text-fg/75 hover:text-fg"><RefreshCw size={12} /> Refresh</button>
      </div>

      {!rows ? <p className="text-fg/65 text-sm text-center p-6 font-bold">Loading…</p> : rows.length === 0 ? (
        <p className="text-fg/65 text-sm text-center p-6 font-bold">No {filter === 'All' ? '' : filter.toLowerCase() + ' '}{kind} requests.</p>
      ) : (
        <div className="bg-surface border border-white/10 rounded-xl overflow-x-auto">
          <table className="w-full text-left text-xs min-w-[640px]">
            <thead className="text-fg/65 text-[10px] font-black uppercase tracking-wider border-b border-white/5">
              <tr>
                <th className="px-4 py-3">Who</th>
                <th className="px-4 py-3">{kind === 'leave' ? 'Leave' : 'Date'}</th>
                <th className="px-4 py-3 text-right">{kind === 'leave' ? 'Days' : 'Hours'}</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3">Status</th>
                {data.canDecide && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r._id} className="border-b border-white/5">
                  <td className="px-4 py-2.5 font-bold text-fg">{r.userName}</td>
                  <td className="px-4 py-2.5 text-fg/80">{kind === 'leave' ? `${r.type} · ${r.from}${r.to !== r.from ? ` to ${r.to}` : ''}` : r.date}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{kind === 'leave' ? r.days : r.hours}</td>
                  <td className="px-4 py-2.5 text-fg/75 max-w-[240px] truncate" title={r.reason}>{r.reason || '-'}</td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${TONE[r.status] || ''}`}>{r.status}</span>
                    {r.decidedBy && <span className="block text-[10px] text-fg/65 mt-0.5" title={r.decisionNote}>by {r.decidedBy}{r.decisionNote ? ` - ${r.decisionNote}` : ''}</span>}
                  </td>
                  {data.canDecide && (
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      {r.status === 'Pending' && (
                        <span className="inline-flex gap-1.5">
                          <button type="button" disabled={busy === r._id} onClick={() => decide(which, r, 'approve')} className="px-2.5 py-1 rounded-lg bg-green-500/15 text-success text-[11px] font-bold flex items-center gap-1 disabled:opacity-50"><CheckCircle size={11} /> Approve</button>
                          <button type="button" disabled={busy === r._id} onClick={() => decide(which, r, 'reject')} className="px-2.5 py-1 rounded-lg bg-red-500/15 text-danger text-[11px] font-bold flex items-center gap-1 disabled:opacity-50"><XCircle size={11} /> Reject</button>
                        </span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
