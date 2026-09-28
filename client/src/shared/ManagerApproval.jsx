import React, { useCallback, useRef, useState } from 'react';

// A manager's approval, asked for on this screen: the approver types their
// PIN, the server checks they hold the permission, and hands back a signed
// approval good for this one record for two minutes. The person at the till
// stays signed in throughout.
//
//   const { requestApproval, approvalDialog } = useManagerApproval(apiFetch);
//   const approval = await requestApproval({ permission, target, title, detail });
//   // -> the approval string, or null if cancelled
//   ...render {approvalDialog} somewhere in the tree.
export function useManagerApproval(apiFetch) {
  const [ask, setAsk] = useState(null);           // { permission, target, title, detail, pin, busy, error }
  const resolver = useRef(null);

  const finish = (value) => { const r = resolver.current; resolver.current = null; setAsk(null); r?.(value); };

  const requestApproval = useCallback(({ permission, target, title, detail }) => new Promise((resolve) => {
    resolver.current = resolve;
    setAsk({ permission, target: String(target || ''), title, detail, pin: '', busy: false, error: '' });
  }), []);

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!ask) return;
    setAsk(a => ({ ...a, busy: true, error: '' }));
    try {
      const r = await apiFetch('/api/users/authorize', { method: 'POST', body: JSON.stringify({ pin: ask.pin, permission: ask.permission, target: ask.target }) });
      const d = await r.json();
      if (!d.success || !d.approval) { setAsk(a => ({ ...a, busy: false, pin: '', error: d.error || 'That PIN was not accepted.' })); return; }
      finish({ approval: d.approval, approverName: d.approver?.name || '' });
    } catch { setAsk(a => ({ ...a, busy: false, error: 'No connection to the server.' })); }
  };

  const approvalDialog = ask ? (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => finish(null)}>
      <form role="dialog" aria-label={ask.title} onSubmit={submit} onClick={e => e.stopPropagation()}
        className="bg-sidebar-bg border border-white/10 rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <h2 className="font-black text-fg mb-1">{ask.title}</h2>
        {ask.detail && <p className="text-fg/75 text-sm mb-3 whitespace-pre-line">{ask.detail}</p>}
        <label htmlFor="mgr-pin" className="text-[10px] font-bold text-fg/70 uppercase tracking-widest block mb-1.5">Approver PIN</label>
        <input id="mgr-pin" type="password" inputMode="numeric" autoComplete="off" autoFocus value={ask.pin}
          onChange={e => setAsk(a => ({ ...a, pin: e.target.value.replace(/\D/g, '').slice(0, 8) }))}
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-lg tracking-[0.4em] text-fg mb-2" />
        {ask.error && <p className="text-danger text-xs mb-2">{ask.error}</p>}
        <div className="flex justify-end gap-2 mt-2">
          <button type="button" onClick={() => finish(null)} className="px-4 py-2 rounded-xl bg-white/5 text-fg/80 text-sm font-bold">Cancel</button>
          <button type="submit" disabled={ask.busy || ask.pin.length < 4} className="px-4 py-2 rounded-xl bg-brand text-on-brand text-sm font-bold disabled:opacity-50">{ask.busy ? 'Checking…' : 'Approve'}</button>
        </div>
      </form>
    </div>
  ) : null;

  return { requestApproval, approvalDialog };
}
