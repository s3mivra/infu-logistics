import { useState } from 'react';
import { X } from 'lucide-react';
import * as ui from '../../shared/ui';
import { dateStr } from '../../shared/businessDay.js';

// Ledger Editor (superadmin only). The ledger is append-only: saving posts a
// reversal of this entry and the corrected one; voiding posts the reversal
// alone. The original stays in the list, marked as changed.
export default function LedgerEntryEditor({ entry, accounts, apiFetch, onDone, onClose }) {
  const [date, setDate] = useState(entry.date ? dateStr(new Date(entry.date)) : '');
  const [description, setDescription] = useState(entry.description || '');
  const [lines, setLines] = useState(entry.lines.map((l) => ({
    accountCode: l.accountCode, debit: l.debit > 0 ? String(l.debit) : '', credit: l.credit > 0 ? String(l.credit) : '',
  })));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const totalD = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const totalC = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  const balanced = Math.round(totalD * 100) === Math.round(totalC * 100) && totalD > 0;
  const setLine = (i, patch) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const send = async (path, body, okMsg) => {
    setBusy(true);
    try {
      const d = await (await apiFetch(`/api/journal/${entry._id}/${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })).json();
      if (!d.success) { ui.alert(d.error || 'Nothing was changed.'); return; }
      ui.toast(okMsg, { tone: 'success' });
      onDone();
    } catch { ui.alert('Network error - nothing was changed.'); } finally { setBusy(false); }
  };

  const save = () => send('correct', { date, description, reason: reason.trim(), lines }, 'Entry corrected.');
  const voidIt = async () => {
    if (!(await ui.confirm({
      title: `Void ${entry.reference}?`,
      message: 'A reversal is posted on the same date, so this entry adds up to zero. The entry itself stays in the ledger, marked as voided.',
      confirmLabel: 'Void entry',
    }))) return;
    send('void', { reason: reason.trim() }, 'Entry voided.');
  };

  const field = 'w-full bg-page-bg border border-white/10 rounded p-2 text-sm text-fg outline-none';
  return (
    <div className="mt-3 border border-brand/40 rounded-lg p-4 space-y-3 bg-surface" aria-label={`Edit ${entry.reference}`}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-fg">Edit {entry.reference}</p>
        <button type="button" onClick={onClose} aria-label="Close editor" className="text-fg/70 hover:text-fg"><X size={16} /></button>
      </div>
      <p className="text-[11px] text-fg/70">Saving keeps this entry and posts a reversal plus the corrected entry, so reports already printed can still be traced. Closed months are allowed.</p>
      <div className="flex gap-2 flex-wrap">
        <label className="text-[10px] text-fg/80 font-bold uppercase">Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={field} />
        </label>
        <label className="text-[10px] text-fg/80 font-bold uppercase flex-1 min-w-[12rem]">Description
          <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} className={field} />
        </label>
      </div>
      {lines.map((l, i) => (
        <div key={i} className="flex gap-2 items-center">
          <select aria-label={`Line ${i + 1} account`} value={l.accountCode} onChange={(e) => setLine(i, { accountCode: e.target.value })} className={`${field} flex-1`}>
            <option value="">Select account...</option>
            {accounts.map((a) => <option key={a.accountCode} value={a.accountCode}>{a.accountCode} - {a.accountName}</option>)}
          </select>
          <input aria-label={`Line ${i + 1} debit`} type="number" placeholder="Debit" value={l.debit} onChange={(e) => setLine(i, { debit: e.target.value, credit: '' })} className={`${field} w-28`} />
          <input aria-label={`Line ${i + 1} credit`} type="number" placeholder="Credit" value={l.credit} onChange={(e) => setLine(i, { credit: e.target.value, debit: '' })} className={`${field} w-28`} />
          <button type="button" aria-label={`Remove line ${i + 1}`} disabled={lines.length <= 2}
            onClick={() => setLines(lines.filter((_, j) => j !== i))} className="text-fg/70 hover:text-danger disabled:opacity-30"><X size={14} /></button>
        </div>
      ))}
      <button type="button" onClick={() => setLines([...lines, { accountCode: '', debit: '', credit: '' }])} className="text-xs text-brand-text hover:text-fg">+ Add line</button>
      <p className={`text-xs font-bold ${balanced ? 'text-fg/70' : 'text-danger'}`}>
        Debits {totalD.toFixed(2)} · Credits {totalC.toFixed(2)}{balanced ? '' : ' - must be equal'}
      </p>
      <label className="text-[10px] text-fg/80 font-bold uppercase block">Reason (required)
        <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. wrong amount on the receipt" className={field} />
      </label>
      <div className="flex gap-2 justify-end flex-wrap">
        <button type="button" disabled={busy || !reason.trim()} onClick={voidIt}
          className="px-3 py-2 rounded text-xs font-bold uppercase border border-danger text-danger disabled:opacity-40">Void entry</button>
        <button type="button" disabled={busy || !reason.trim() || !balanced} onClick={save}
          className="px-3 py-2 rounded text-xs font-bold uppercase bg-brand text-on-brand disabled:opacity-40">Save correction</button>
      </div>
    </div>
  );
}
