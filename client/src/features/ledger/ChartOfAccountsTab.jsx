import { Plus, Edit, Trash2, Download, Zap, Wallet } from 'lucide-react';

// The chart of accounts.
// Moved out of LedgerTab.jsx as it was; it reads everything it needs from its props.
export default function ChartOfAccountsTab({
  ledgerSubTab, downloadAccountBalances, exportBusy, obEntry, fetchOpeningBalances, peso, obRows, setObRows,
  balanceSheetAccounts, obMeta, setObMeta, submitOpeningBalances, obBusy, isSuperAdmin, seedPaymentSubaccounts, coaParent,
  setCoaParent, coaParents, coaNewName, setCoaNewName, addCoaChild, coaBusy, coaChildrenOf, coaEditId,
  coaEditName, setCoaEditName, renameCoaChild, setCoaEditId, deleteCoaChild,
}) {
  return (
    <>
    {(ledgerSubTab === 'coa' || ledgerSubTab === 'accperiods') && (
      <div className={`space-y-4${ledgerSubTab === 'accperiods' ? ' lg:row-span-2' : ''}`}>
      {/* ── OPENING BALANCES ──────────────────────────────────────────
          Onboarding a business that already has a history. Each row is an
          account's natural balance as a positive number; the server picks
          the debit/credit side and plugs the difference to Owner's
          Capital, so nobody hand-balances a multi-line entry. */}
      <div className="bg-surface border border-white/10 rounded-2xl p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
          <div>
            <h3 className="text-fg font-black uppercase tracking-wider text-sm flex items-center gap-2">
              <Wallet size={15} className="text-brand-text" /> Opening Balances
            </h3>
            {/* The value table: every account with its balance, on the
                side that account naturally carries. Useful for handing an
                accountant a position without exporting the whole ledger. */}
            <button onClick={() => downloadAccountBalances()} disabled={exportBusy === 'account-balances'}
              className="mt-2 flex items-center gap-1.5 text-[10px] border border-white/15 text-fg/70 hover:text-fg hover:bg-white/5 px-3 py-1.5 rounded-lg font-bold uppercase tracking-wider transition disabled:opacity-40">
              <Download size={12} /> {exportBusy === 'account-balances' ? 'Working…' : 'Export Account Balances'}
            </button>
            <p className="text-[11px] text-fg/70 mt-1">
              Carry an existing balance sheet into the books. Balance-sheet accounts only.
            </p>
          </div>
          {obEntry === undefined && (
            <button onClick={fetchOpeningBalances}
              className="border border-white/15 text-fg px-3 py-1.5 rounded-lg font-bold text-[10px] uppercase tracking-wider hover:bg-white/5 transition">
              Load
            </button>
          )}
        </div>

        {obEntry && (
          <div className="mt-3 text-[11px] text-warning bg-amber-500/10 border border-amber-500/25 rounded-lg p-2.5">
            Already posted as <span className="font-black">{obEntry.reference}</span> on{' '}
            {new Date(obEntry.date).toLocaleDateString()} ({peso(obEntry.totalDebit)}).
            Posting again adds a second full set and doubles every carried-in balance.
          </div>
        )}

        <div className="mt-4 space-y-2">
          {obRows.map((r, i) => (
            <div key={i} className="flex gap-2 items-start">
              <select value={r.accountCode}
                onChange={e => setObRows(rows => rows.map((x, j) => j === i ? { ...x, accountCode: e.target.value } : x))}
                className="flex-1 min-w-0 bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-fg text-xs outline-none focus:border-brand">
                <option value="">Select an account…</option>
                {(balanceSheetAccounts || []).map(a => (
                  <option key={a.code} value={a.code}>{a.code} - {a.name}</option>
                ))}
              </select>
              <input type="number" step="0.01" value={r.amount} placeholder="0.00"
                onChange={e => setObRows(rows => rows.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))}
                className="w-32 shrink-0 bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-fg text-xs text-right tabular-nums outline-none focus:border-brand" />
              <button onClick={() => setObRows(rows => rows.length > 1 ? rows.filter((_, j) => j !== i) : rows)}
                disabled={obRows.length === 1}
                className="shrink-0 text-fg/65 hover:text-danger disabled:opacity-20 transition p-2" title="Remove row">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          <button onClick={() => setObRows(rows => [...rows, { accountCode: '', amount: '' }])}
            className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-brand-text transition pt-1">
            <Plus size={12} /> Add account
          </button>
        </div>

        {/* Live preview of what the server will do, so the plug is not a
            surprise after posting. */}
        {(() => {
          const rows = obRows.filter(r => r.accountCode && parseFloat(r.amount));
          if (rows.length === 0) return null;
          const byCode = new Map((balanceSheetAccounts || []).map(a => [a.code, a]));
          let dr = 0, cr = 0;
          for (const r of rows) {
            const t = byCode.get(r.accountCode)?.type;
            const amt = parseFloat(r.amount) || 0;
            if (t === 'asset') { dr += Math.max(0, amt); cr += Math.max(0, -amt); }
            else { cr += Math.max(0, amt); dr += Math.max(0, -amt); }
          }
          const diff = Math.round((dr - cr) * 100) / 100;
          return (
            <div className="mt-3 bg-page-bg border border-white/10 rounded-lg p-3 text-[11px] space-y-1">
              <div className="flex justify-between"><span className="text-fg/75">Total debits</span><span className="tabular-nums text-fg/80">{peso(dr)}</span></div>
              <div className="flex justify-between"><span className="text-fg/75">Total credits</span><span className="tabular-nums text-fg/80">{peso(cr)}</span></div>
              <div className="flex justify-between border-t border-white/10 pt-1 mt-1">
                <span className="text-fg/70 font-bold">{diff === 0 ? 'Balanced' : "To Owner's Capital"}</span>
                <span className={`tabular-nums font-black ${diff === 0 ? 'text-success' : 'text-brand-text'}`}>
                  {diff === 0 ? '-' : peso(Math.abs(diff))}
                </span>
              </div>
            </div>
          );
        })()}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-4">
          <div>
            <label className="text-[10px] text-fg/70 uppercase tracking-widest font-bold block mb-1">As of date</label>
            <input type="date" value={obMeta.date}
              onChange={e => setObMeta(m => ({ ...m, date: e.target.value }))}
              className="w-full bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-fg text-xs outline-none focus:border-brand" />
          </div>
          <div>
            <label className="text-[10px] text-fg/70 uppercase tracking-widest font-bold block mb-1">Reference No.</label>
            <input type="text" value={obMeta.referenceNumber} placeholder="Prior-books ref, audit ref..."
              onChange={e => setObMeta(m => ({ ...m, referenceNumber: e.target.value }))}
              className="w-full bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-fg text-xs outline-none focus:border-brand" />
          </div>
        </div>
        <div className="mt-2">
          <label className="text-[10px] text-fg/70 uppercase tracking-widest font-bold block mb-1">Remarks</label>
          <textarea value={obMeta.note} rows={2} placeholder="Where these figures came from"
            onChange={e => setObMeta(m => ({ ...m, note: e.target.value }))}
            className="w-full bg-page-bg border border-white/10 rounded-lg px-3 py-2 text-fg text-xs outline-none focus:border-brand" />
        </div>

        <button onClick={() => submitOpeningBalances(!!obEntry)} disabled={obBusy}
          className={`w-full mt-4 px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition disabled:opacity-50 ${
            obEntry ? 'bg-amber-500 hover:bg-amber-400 text-page-bg' : 'bg-brand hover:bg-brand-dark text-on-brand'}`}>
          {obBusy ? 'Posting…' : obEntry ? 'Post Again (doubles balances)' : 'Post Opening Balances'}
        </button>
      </div>

        {/* Add child account */}
        <div className="bg-surface border border-white/10 rounded-2xl p-5">
          <h3 className="text-lg font-black text-fg mb-1">Add Sub-Account</h3>
          <p className="text-xs text-fg/65 mb-4">Create a custom child account under any parent. It inherits the parent's classification and becomes usable in journal entries and reports.</p>
          {isSuperAdmin && (
            <button onClick={seedPaymentSubaccounts}
              title="Auto-create standard payment-method sub-accounts (GCash, Maya, Foodpanda, Lalamove, etc.). Idempotent - existing accounts are skipped."
              className="w-full sm:w-auto text-[10px] uppercase tracking-widest font-black bg-white/5 hover:bg-white/10 text-brand-text border border-brand/20 px-3 py-2 rounded-lg transition flex items-center justify-center gap-1.5 mb-4">
              <Zap size={11}/> Seed payment methods
            </button>
          )}
          <div className="flex flex-col sm:flex-row gap-2">
            <select value={coaParent} onChange={e => setCoaParent(e.target.value)}
              className="flex-1 min-w-0 bg-page-bg border border-white/10 rounded-xl px-3 py-2.5 text-fg text-sm font-bold outline-none focus:border-brand/60">
              <option value="">Select parent account…</option>
              {coaParents.map(p => (
                <option key={p.code} value={p.code}>{p.code} · {p.name}{p.isParent ? ' (header)' : ''}</option>
              ))}
            </select>
            <input type="text" placeholder="New account name" value={coaNewName}
              onChange={e => setCoaNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addCoaChild(); }}
              className="flex-1 min-w-0 bg-page-bg border border-white/10 rounded-xl px-3 py-2.5 text-fg text-sm font-bold outline-none focus:border-brand/60 placeholder-fg/70" />
            <button onClick={addCoaChild} disabled={coaBusy}
              className="shrink-0 whitespace-nowrap inline-flex items-center justify-center gap-1.5 bg-brand text-on-brand font-black text-xs uppercase tracking-widest px-5 py-2.5 rounded-xl hover:bg-brand-dark transition disabled:opacity-50">
              <Plus size={14} /> Add
            </button>
          </div>
        </div>

        {/* Existing custom accounts grouped by parent */}
        <div className="bg-surface border border-white/10 rounded-2xl p-5">
          <h3 className="text-lg font-black text-fg mb-4">Custom Sub-Accounts</h3>
          {coaParents.filter(p => coaChildrenOf(p.code).length > 0).length === 0 ? (
            <p className="text-sm text-fg/65 italic">No custom accounts yet. Add one above.</p>
          ) : coaParents.filter(p => coaChildrenOf(p.code).length > 0).map(p => (
            <div key={p.code} className="mb-4 last:mb-0">
              <p className="text-[10px] font-black uppercase tracking-widest text-fg/70 mb-1.5">{p.code} · {p.name}</p>
              <div className="space-y-1.5">
                {coaChildrenOf(p.code).map(c => (
                  <div key={c._id} className="flex items-center gap-2 bg-page-bg border border-white/10 rounded-xl px-3 py-2">
                    <span className="font-mono text-xs text-brand-text w-16 shrink-0">{c.code}</span>
                    {coaEditId === c._id ? (
                      <>
                        <input autoFocus value={coaEditName} onChange={e => setCoaEditName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') renameCoaChild(c._id); if (e.key === 'Escape') setCoaEditId(null); }}
                          className="flex-1 bg-surface border border-brand/40 rounded-lg px-2 py-1 text-fg text-sm outline-none" />
                        <button onClick={() => renameCoaChild(c._id)} className="text-success text-xs font-black uppercase">Save</button>
                        <button onClick={() => setCoaEditId(null)} className="text-fg/70 hover:text-fg text-xs">Cancel</button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 text-sm font-bold text-fg">
                          {c.name}
                          {/* Its code in the books kept before - what the setup workbook's sheets use. */}
                          {c.externalCode && <span className="ml-2 font-mono text-[11px] font-normal text-fg/65" title="Your code from the previous books">{c.externalCode}</span>}
                        </span>
                        <button onClick={() => { setCoaEditId(c._id); setCoaEditName(c.name); }} title="Rename"
                          className="text-info p-1"><Edit size={13} /></button>
                        <button onClick={() => deleteCoaChild(c._id)} title="Delete"
                          className="text-danger p-1"><Trash2 size={13} /></button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    )}
    </>
  );
}
