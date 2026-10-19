import React from 'react';
import { X, Lock, Settings, ChevronRight, ChevronDown, CreditCard, Wallet } from 'lucide-react';

// Which account each payment method lands in.
// Moved out of LedgerTab.jsx as it was; it reads everything it needs from its props.
export default function PaymentRoutingTab({
  ledgerSubTab, paymentMap, cashAndBankAccounts, arAccounts, apAccounts, isSuperAdmin, setLedgerSubTab, coaAccounts,
  savePaymentMapping, resetPaymentMapping, expandedPayRouteGroups, togglePayRouteGroup, toggleAccountActive,
}) {
  return (
    <>
    {(ledgerSubTab === 'payroute' || ledgerSubTab === 'accperiods') && (() => {
      const methods = Array.from(new Set([
        ...Object.keys(paymentMap?.defaults || {}),
        ...Object.keys(paymentMap?.effective || {}),
      ])).sort();
      // Group eligible target accounts by parent (cash, bank, e-wallet, AR, AP)
      const allEligible = [
        ...(cashAndBankAccounts || []),
        ...(arAccounts || []),
        ...(apAccounts || []),
      ];
      // Superadmin-only edit gate. Server enforces this on PUT/DELETE
      // (returns 403 to non-superadmins) - mirror it in the UI so the
      // controls don't tease the user. Everyone else gets a read-only view.
      const canEdit = !!isSuperAdmin;
      const customSubsAvailable = allEligible.filter(a => a.code && /\d{3,}\d{3}/.test(a.code) && !['111000','112000','113000','120000','220000'].includes(a.code)).length;
      return (
        <div className="bg-surface border border-white/10 rounded-2xl p-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-xl font-black text-fg flex items-center gap-2"><CreditCard size={18} className="text-brand-text"/> Payment Method Routing</h3>
              <p className="text-fg/70 text-xs font-bold uppercase tracking-widest mt-1">
                Map each POS payment method to a specific account
                {customSubsAvailable > 0 && <span className="ml-2 text-success normal-case tracking-normal">· {customSubsAvailable} custom sub-account{customSubsAvailable === 1 ? '' : 's'} available</span>}
              </p>
              {!canEdit && (
                <p className="mt-2 text-[10px] uppercase tracking-widest font-black text-warning bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1.5 inline-flex items-center gap-1.5">
                  <Lock size={11}/> Superadmin only - sign in as superadmin to change routes
                </p>
              )}
            </div>
            {canEdit && (
              <button onClick={() => setLedgerSubTab('coa')}
                className="shrink-0 bg-white/5 hover:bg-white/10 border border-white/10 text-fg/70 hover:text-fg text-[10px] uppercase tracking-widest font-black px-3 py-2 rounded-lg transition flex items-center gap-1.5"
                title="Rename / delete custom sub-accounts in the Chart of Accounts view">
                <Settings size={11}/> Manage in COA
              </button>
            )}
          </div>


          {(() => {
            // Group payment methods by the canonical PARENT account (first
            // 3 digits of the default → "<3digits>000"). The parent row is
            // always visible; children only render when expanded.
            const PARENT_ORDER = ['111000','112000','113000','120000','220000'];
            const PARENT_LABEL = {
              '111000': 'Cash on Hand',
              '112000': 'Cash in Bank',
              '113000': 'E-Wallet',
              '120000': 'Accounts Receivable',
              '220000': 'Accounts Payable',
            };
            // Seed a group for every canonical parent so headers render even
            // when no payment method currently routes through it.
            const groups = {};
            for (const pc of PARENT_ORDER) {
              groups[pc] = { parentMethods: [], childMethods: [], subAccounts: [] };
            }
            // All custom sub-accounts under each parent - drives the [N SUB]
            // count and the "available sub-accounts" list inside the group.
            for (const a of (coaAccounts || [])) {
              if (!a.custom || !a.parent) continue;
              if (groups[a.parent]) groups[a.parent].subAccounts.push(a);
            }
            // Map: account code → payment methods routing to it. So when we
            // list Metrobank we can show which methods (if any) currently
            // book to it.
            const codeToMethods = {};
            for (const m of methods) {
              const eff = paymentMap?.effective?.[m] || paymentMap?.defaults?.[m] || '111000';
              (codeToMethods[eff] ||= []).push(m);
            }
            for (const m of methods) {
              const def = paymentMap?.defaults?.[m] || '111000';
              const parentCode = String(def).slice(0, 3) + '000';
              if (!groups[parentCode]) groups[parentCode] = { parentMethods: [], childMethods: [], subAccounts: [] };
              if (def === parentCode) groups[parentCode].parentMethods.push(m);
              else groups[parentCode].childMethods.push(m);
            }
            for (const k of Object.keys(groups)) {
              groups[k].parentMethods.sort();
              groups[k].childMethods.sort();
              groups[k].subAccounts.sort((a, b) => a.code.localeCompare(b.code));
            }
            const renderRow = (m, indent = false) => {
              const def = paymentMap?.defaults?.[m] || '111000';
              const eff = paymentMap?.effective?.[m] || def;
              const isOverride = paymentMap?.overrides?.[m];
              const effName = (allEligible.find(a => a.code === eff)?.name) || (coaAccounts.find(a => a.code === eff)?.name) || eff;
              return (
                <tr key={m} className="border-b border-white/5 hover:bg-page-bg/30">
                  <td className={`py-2 text-fg font-bold text-sm ${indent ? 'pl-10' : 'pl-3'}`}>
                    {indent && <span className="text-fg/65 mr-2">↳</span>}{m}
                  </td>
                  <td className="py-2 text-fg/70 text-xs font-mono">{def}</td>
                  <td className="py-2">
                    {canEdit ? (
                      <select value={eff} onChange={e => savePaymentMapping(m, e.target.value)}
                        className="bg-page-bg border border-white/10 rounded-lg px-2 py-1 text-fg text-xs font-bold outline-none focus:border-brand/60">
                        {allEligible.map(a => (
                          <option key={a.code} value={a.code}>{a.name} ({a.code})</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-fg text-xs font-bold font-mono">{effName} <span className="text-fg/65">({eff})</span></span>
                    )}
                    {canEdit && <span className="ml-2 text-[10px] text-fg/65">{effName}</span>}
                    {isOverride && <span className="ml-2 text-[9px] uppercase tracking-widest font-black text-warning bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 rounded">Override</span>}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    {canEdit && isOverride && (
                      <button onClick={() => resetPaymentMapping(m)} className="text-[10px] uppercase tracking-widest font-black bg-white/5 hover:bg-white/10 text-fg/65 hover:text-fg px-3 py-1 rounded-lg transition">Reset</button>
                    )}
                  </td>
                </tr>
              );
            };
            return (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-fg/80 border-b border-white/10 text-[10px] uppercase tracking-widest">
                      <th className="pb-2 pl-3">Payment Method</th>
                      <th className="pb-2">Default</th>
                      <th className="pb-2">Currently Routes To</th>
                      <th className="pb-2 pr-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PARENT_ORDER.filter(pc => groups[pc]).map(parentCode => {
                      const { parentMethods, childMethods, subAccounts } = groups[parentCode];
                      const isExpanded = expandedPayRouteGroups.has(parentCode);
                      // Count sub-accounts (real children of the parent in the COA),
                      // not just methods. Adding Metrobank under Cash in Bank should
                      // increment this immediately.
                      const childCount = subAccounts.length;
                      return (
                        <React.Fragment key={parentCode}>
                          {/* Group header - clickable to expand/collapse. */}
                          <tr className="bg-white/[0.03] border-b border-white/10 cursor-pointer hover:bg-white/[0.06] transition"
                              onClick={() => childCount > 0 && togglePayRouteGroup(parentCode)}>
                            <td colSpan={4} className="py-2.5 pl-3 pr-3">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  {childCount > 0 ? (
                                    isExpanded
                                      ? <ChevronDown size={14} className="text-brand-text"/>
                                      : <ChevronRight size={14} className="text-fg/70"/>
                                  ) : <span className="w-[14px]" />}
                                  <span className="text-[10px] uppercase tracking-widest font-black text-fg/70">{parentCode}</span>
                                  <span className="text-fg font-black text-sm">{PARENT_LABEL[parentCode] || parentCode}</span>
                                  {childCount > 0 && (
                                    <span className="text-[9px] uppercase tracking-widest font-black bg-brand/15 text-brand-text border border-brand/30 px-1.5 py-0.5 rounded">
                                      {childCount} sub
                                    </span>
                                  )}
                                </div>
                                <span className="text-[10px] uppercase tracking-widest font-black text-fg/65">
                                  {parentMethods.length === 1 ? parentMethods[0] : parentMethods.length > 1 ? `${parentMethods.length} methods` : ''}
                                </span>
                              </div>
                            </td>
                          </tr>
                          {/* Parent-account row is intentionally omitted - the header
                              already displays the same info, and parent-account routing
                              is locked (parents cannot be remapped from a child UI). */}
                          {/* Expanded: list every sub-account under this parent (custom
                              children from the COA), with the payment method(s) routing
                              to it (if any). Lets the user see Metrobank/BPI/etc. even
                              when no payment method targets them yet. */}
                          {isExpanded && subAccounts.map(sa => {
                            const methodsHere = codeToMethods[sa.code] || [];
                            return (
                              <tr key={`${parentCode}-sa-${sa.code}`} className="border-b border-white/5 hover:bg-page-bg/30">
                                <td className="py-2 pl-10 text-fg/80 text-sm">
                                  <span className="text-fg/65 mr-2">↳</span>
                                  <span className={`font-bold ${sa.isActive === false ? 'line-through text-fg/65' : ''}`}>{sa.name}</span>
                                  {sa.isActive === false && (
                                    <span className="ml-2 text-[9px] uppercase tracking-widest font-black bg-white/10 text-fg/70 px-1.5 py-0.5 rounded">Inactive</span>
                                  )}
                                </td>
                                <td className="py-2 text-fg/70 text-xs font-mono">{sa.code}</td>
                                <td className="py-2">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    {/* Existing method chips - click ✕ to detach (resets that method back to its default). */}
                                    {methodsHere.map(m => (
                                      <span key={m} className="text-[10px] uppercase tracking-widest font-black bg-brand/15 text-brand-text border border-brand/30 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
                                        {m}
                                        {canEdit && (
                                          <button onClick={() => resetPaymentMapping(m)}
                                            title={`Detach ${m} from this account (resets to default)`}
                                            className="text-brand-text transition">
                                            <X size={10}/>
                                          </button>
                                        )}
                                      </span>
                                    ))}
                                    {/* Inline picker: route a POS payment method to THIS sub-account.
                                        Filter to methods whose canonical default lives under the
                                        SAME parent - keeps classification clean (no GCash under
                                        Cash on Hand, no Lalamove under E-Wallet). */}
                                    {canEdit && (() => {
                                      const eligibleMethods = methods.filter(m => {
                                        if (methodsHere.includes(m)) return false; // already routed here
                                        const methodDefault = paymentMap?.defaults?.[m] || '111000';
                                        const methodParent = String(methodDefault).slice(0, 3) + '000';
                                        return methodParent === parentCode;
                                      });
                                      if (eligibleMethods.length === 0) {
                                        return (
                                          <span className="text-[10px] uppercase tracking-widest font-black text-fg/65 italic">
                                            All matching methods already routed
                                          </span>
                                        );
                                      }
                                      return (
                                        <select
                                          value=""
                                          onChange={e => { if (e.target.value) savePaymentMapping(e.target.value, sa.code); }}
                                          className="bg-page-bg border border-white/10 rounded-lg px-2 py-1 text-fg/65 text-[10px] font-bold outline-none focus:border-brand/60 hover:text-fg"
                                          title={`Route a ${PARENT_LABEL[parentCode] || ''} payment method to this sub-account`}>
                                          <option value="">+ Route a method here…</option>
                                          {eligibleMethods.map(m => (
                                            <option key={m} value={m}>{m}</option>
                                          ))}
                                        </select>
                                      );
                                    })()}
                                    {!canEdit && methodsHere.length === 0 && (
                                      <span className="text-[10px] uppercase tracking-widest font-black text-fg/65 italic">No method routes here yet</span>
                                    )}
                                  </div>
                                </td>
                                <td className="py-2 pr-3 text-right">
                                  {canEdit ? (
                                    <button onClick={() => toggleAccountActive(sa._id, sa.isActive === false)}
                                      title={sa.isActive === false
                                        ? 'Bring back as a selectable payment method'
                                        : 'Remove from POS/portal picker without deleting - history stays intact'}
                                      className={`text-[9px] uppercase tracking-widest font-black px-2 py-1 rounded transition ${
                                        sa.isActive === false
                                          ? 'bg-green-500/10 text-success hover:bg-green-500/20'
                                          : 'bg-white/5 text-fg/75 hover:bg-white/10 hover:text-fg'
                                      }`}>
                                      {sa.isActive === false ? 'Reactivate' : 'Deactivate'}
                                    </button>
                                  ) : (
                                    <span className="text-[10px] uppercase tracking-widest font-black text-fg/65">Sub-account</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })()}
          <p className="text-[10px] text-fg/65">
            Changes take effect immediately for new orders and settlements. Past journal entries are not modified.
            Need a sub-account for a specific bank (e.g. Metrobank 112001)? Add it in <span className="text-brand-text font-bold">Chart of Accounts</span> under the parent (Cash in Bank), then it appears here automatically.
          </p>
        </div>
      );
    })()}
    </>
  );
}
