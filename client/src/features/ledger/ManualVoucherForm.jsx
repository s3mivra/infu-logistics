import { useState } from 'react';
import * as ui from '../../shared/ui';
import { todayStr } from '../../shared/businessDay.js';

// A check voucher written by hand: a payment that no bill, refund or advance
// raised one for. By default it also records the payment in the books (the
// account it is charged to, against the cash or bank account it left from).
// Tick "already in the books" for a voucher that only documents a payment
// recorded some other way - then nothing is posted.
const inputCls = 'w-full bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-fg text-sm outline-none focus:border-brand/60';
const labelCls = 'text-[10px] text-fg/70 uppercase tracking-widest font-bold block mb-1';

export default function ManualVoucherForm({ apiFetch, cashAccounts = [], accounts = [], onSaved, onCancel }) {
  const [f, setF] = useState({
    payeeName: '', payeeType: 'other', amount: '', date: todayStr(), sourceAccount: cashAccounts[0]?.code || '111000',
    referenceNumber: '', chargeAccount: '', notes: '', alreadyRecorded: false,
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF(p => ({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  // Not another cash or bank account: that is a transfer, not a payment.
  const chargeable = accounts.filter(a => !/^11[1-4]/.test(String(a.code)));
  const amount = Number(f.amount);
  const ready = f.payeeName.trim() && amount > 0 && f.sourceAccount && f.notes.trim() && (f.alreadyRecorded || f.chargeAccount);

  const save = async (e) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    try {
      const d = await (await apiFetch('/api/check-vouchers', { method: 'POST', body: JSON.stringify({ ...f, amount }) })).json();
      if (!d.success) return ui.alert(d.error || 'Could not save the voucher.');
      ui.toast(`Check Voucher ${d.voucher.voucherNumber} issued${d.journalReference ? ` and posted (${d.journalReference})` : ' - nothing posted'}.`, { tone: 'success' });
      onSaved?.(d.voucher);
    } catch { ui.alert('Network error - check the voucher list before trying again.'); }
    finally { setBusy(false); }
  };

  return (
    <form onSubmit={save} className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
      <h4 className="text-sm font-black text-fg">New check voucher</h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="sm:col-span-2">
          <label className={labelCls}>Pay to</label>
          <input value={f.payeeName} onChange={set('payeeName')} maxLength={120} placeholder="Name on the check" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Payee is a</label>
          <select value={f.payeeType} onChange={set('payeeType')} className={inputCls}>
            <option value="other">Other</option><option value="supplier">Supplier</option><option value="client">Client</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Amount</label>
          <input type="number" min="0" step="0.01" value={f.amount} onChange={set('amount')} placeholder="0.00" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Date</label>
          <input type="date" value={f.date} onChange={set('date')} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Paid from</label>
          <select value={f.sourceAccount} onChange={set('sourceAccount')} className={inputCls}>
            {cashAccounts.map(a => <option key={a.code} value={a.code}>{a.code} - {a.name}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Check / reference no.</label>
          <input value={f.referenceNumber} onChange={set('referenceNumber')} maxLength={60} placeholder="Optional" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Charge to</label>
          <select value={f.chargeAccount} onChange={set('chargeAccount')} disabled={f.alreadyRecorded} className={`${inputCls} disabled:opacity-40`}>
            <option value="">{f.alreadyRecorded ? 'Not needed' : 'Pick the account'}</option>
            {chargeable.map(a => <option key={a.code} value={a.code}>{a.code} - {a.name}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2 lg:col-span-4">
          <label className={labelCls}>What it is for</label>
          <input value={f.notes} onChange={set('notes')} maxLength={300} placeholder="Particulars, as they should read on the voucher" className={inputCls} />
        </div>
      </div>
      <label className="flex items-start gap-2 text-xs text-fg/80">
        <input type="checkbox" checked={f.alreadyRecorded} onChange={set('alreadyRecorded')} className="mt-0.5" />
        <span><b>This payment is already in the books.</b> Issue the voucher as a document only and post nothing. Leave unticked to record the payment now.</span>
      </label>
      <p className="text-[11px] text-fg/70">
        {f.alreadyRecorded
          ? 'Nothing will be posted to the ledger.'
          : 'Saving posts the payment: the "Charge to" account is debited and the "Paid from" account is credited.'}
      </p>
      <div className="flex gap-2">
        <button type="submit" disabled={!ready || busy} className="bg-brand text-on-brand px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider disabled:opacity-40">{busy ? 'Saving…' : 'Issue voucher'}</button>
        <button type="button" onClick={onCancel} className="bg-white/5 text-fg/80 px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider">Cancel</button>
      </div>
    </form>
  );
}
