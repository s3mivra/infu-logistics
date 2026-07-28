import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, CornerDownLeft, Command } from 'lucide-react';
import { useDashboard } from './DashboardContext';

// Command palette — jump anywhere without hunting through the sidebar.
//
// Opened by Ctrl/Cmd+K OR by the button in the header: staff work on
// touchscreens, so a keyboard-only affordance would be invisible to most of
// the people using this. Both routes open the same panel, and the list is
// tappable — arrow keys are an accelerator, not a requirement.

const BUSINESS_TYPE = (import.meta.env.VITE_BUSINESS_TYPE || 'fb').toLowerCase();

export default function CommandPalette({ open, onClose }) {
  const { setActiveTab, setNavMode, setLedgerSubTab, can, isSuperAdmin } = useDashboard();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const allow = (perm) => !perm || isSuperAdmin || can?.(perm);

  // Destinations mirror the sidebar, plus the ledger sub-pages that are
  // otherwise two clicks deep.
  const commands = useMemo(() => ([
    { id: 'orders',      label: 'Orders & POS',      hint: 'Take and manage orders', perm: 'orders.view',      mode: 'libellus' },
    { id: 'inventory',   label: 'Inventory & Stock', hint: 'Stock levels, expiry',   perm: 'inventory.view',   mode: 'libellus' },
    { id: 'procurement', label: 'Procurement',       hint: 'Suppliers, POs',          perm: 'procurement.view', mode: 'libellus' },
    { id: 'clients',     label: 'Clients',           hint: 'Balances, credit limits', perm: 'orders.view',      mode: 'libellus' },
    { id: 'products',    label: BUSINESS_TYPE === 'log' ? 'Catalog Setup' : 'Menu Setup', hint: 'Products, prices', perm: 'products.view', mode: 'libellus' },
    { id: 'analytics',   label: 'Analytics',         hint: 'Sales dashboard',         perm: 'analytics.view',   mode: 'negotium' },
    { id: 'reports',     label: 'Reports',           hint: 'Sales summaries',         perm: 'reports.view',     mode: 'negotium', sub: 'salessummary' },
    { id: 'ledger',      label: 'General Ledger',    hint: 'Journal entries',         perm: 'accounting.view',  mode: 'negotium', sub: 'journal' },
    { id: 'ledger',      label: 'Profit & Loss',     hint: 'P&L statement',           perm: 'accounting.view',  mode: 'negotium', sub: 'pnl' },
    { id: 'ledger',      label: 'Balance Sheet',     hint: 'Assets and liabilities',  perm: 'accounting.view',  mode: 'negotium', sub: 'balance' },
    { id: 'ledger',      label: 'AR & AP',           hint: 'Who owes what',           perm: 'accounting.view',  mode: 'negotium', sub: 'araap' },
    { id: 'ledger',      label: 'Expenses',          hint: 'Record an expense',       perm: 'accounting.view',  mode: 'negotium', sub: 'expenses' },
    { id: 'ledger',      label: 'Revolving Funds',   hint: 'Petty cash',              perm: 'accounting.view',  mode: 'negotium', sub: 'revolving' },
    { id: 'pricing',     label: 'Pricing Control',   hint: 'Prices and margins',      perm: 'products.manage',  mode: 'negotium' },
    { id: 'history',     label: 'Shifts & Cash',     hint: 'Shift history, X-reading', perm: null, superOnly: true, mode: 'negotium' },
    { id: 'audit',       label: 'Audit Report',      hint: 'Who changed what',        perm: 'audit.view',       mode: 'negotium' },
    { id: 'settings',    label: 'Settings',          hint: 'Preferences, appearance', perm: null,               mode: 'negotium' },
  ].filter(c => (c.superOnly ? isSuperAdmin : allow(c.perm)))), [isSuperAdmin, can]);   // eslint-disable-line react-hooks/exhaustive-deps

  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return commands;
    return commands.filter(c =>
      c.label.toLowerCase().includes(t) || (c.hint || '').toLowerCase().includes(t));
  }, [q, commands]);

  useEffect(() => { if (open) { setQ(''); setSel(0); setTimeout(() => inputRef.current?.focus(), 30); } }, [open]);
  useEffect(() => { setSel(0); }, [q]);

  // Keep the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${sel}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const run = (cmd) => {
    if (!cmd) return;
    if (cmd.mode && setNavMode) setNavMode(cmd.mode);
    if (cmd.sub && setLedgerSubTab) setLedgerSubTab(cmd.sub);
    setActiveTab(cmd.id);
    onClose();
  };

  if (!open) return null;

  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); run(results[sel]); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  return (
    <div
      className="fixed inset-0 z-[100001] bg-black/70 backdrop-blur-sm flex items-start justify-center pt-[12vh] px-4 animate-fade-in"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog" aria-modal="true" aria-label="Command palette"
    >
      <div className="bg-surface border border-white/10 rounded-2xl w-full max-w-lg shadow-elev-3 overflow-hidden animate-scale-in">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10">
          <Search size={16} className="text-fg/30 shrink-0" />
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Go to…"
            className="flex-1 bg-transparent text-fg placeholder-white/25 outline-none text-sm font-bold"
          />
          <button onClick={onClose} className="text-[10px] font-black uppercase tracking-wider text-fg/30 hover:text-fg transition px-2 py-1 rounded border border-white/10">
            Esc
          </button>
        </div>

        <div ref={listRef} className="max-h-[50vh] overflow-y-auto custom-scrollbar">
          {results.length === 0 ? (
            <p className="px-4 py-10 text-center text-fg/30 text-sm font-bold">Nothing matches “{q}”.</p>
          ) : results.map((c, i) => (
            <button
              key={`${c.id}-${c.sub || ''}-${c.label}`}
              data-idx={i}
              onClick={() => run(c)}
              onMouseEnter={() => setSel(i)}
              className={`w-full text-left flex items-center gap-3 px-4 py-3 transition ${
                i === sel ? 'bg-brand/15' : 'hover:bg-white/5'
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className={`block text-sm font-bold ${i === sel ? 'text-brand' : 'text-fg'}`}>{c.label}</span>
                {c.hint && <span className="block text-fg/35 text-xs mt-0.5">{c.hint}</span>}
              </span>
              {i === sel && <CornerDownLeft size={13} className="text-brand/60 shrink-0" />}
            </button>
          ))}
        </div>

        <div className="px-4 py-2 border-t border-white/10 flex items-center gap-3 text-[10px] text-fg/25 font-bold uppercase tracking-wider">
          <Command size={11} /> Ctrl+K anywhere
          <span className="ml-auto hidden sm:inline">↑↓ to move · Enter to open</span>
        </div>
      </div>
    </div>
  );
}
