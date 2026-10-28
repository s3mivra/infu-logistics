import { useEffect, useRef, useState } from 'react';
import { HelpCircle, X } from 'lucide-react';

// "?" in the top bar: a few lines on the screen you are on - what it is for
// and the two or three things people do there. The full manual is the user
// guide; this is the answer to "what do I do here?" without leaving the page.
export const SCREEN_TIPS = {
  home: ['Start here each day.', 'Needs your action lists what waits on you: open one to go straight there.', 'Getting started ticks itself off as you set the business up.'],
  orders: ['Take orders and payments here.', 'Tap a product to add it; pick how they paid on the order card.', 'On Account means the client pays later - it shows under Reports › Receivables.'],
  inventory: ['Stock levels, expiry and counts.', 'Live Stock shows what you have; Stock Control is for counts and corrections.', 'Transfers move stock between your own places. To another business, use Hub.'],
  hub: ['Your linked businesses.', 'Send or request stock from another business, and accept what they send you.'],
  production: ['Make products from ingredients.', 'A production order takes ingredients from stock and adds the finished item.'],
  procurement: ['Buying from suppliers.', 'Make a purchase order, then receive it when the goods arrive - stock and the bill follow.', 'Open Reorder forecast to see what to buy next.'],
  clients: ['Your clients and what they owe.', 'Use Collect on a client to record a payment.'],
  quotations: ['Price offers to clients.', 'A quotation turns into an order once the client says yes.'],
  products: ['What you sell and its prices.', 'Add a product, set its price and, if it uses stock, its recipe.'],
  owner: ['Today at a glance: sales, cash, what is owed both ways.'],
  analytics: ['Sales trends and how stock moves.'],
  reports: ['Every report, by group across the top.', 'P&L and Balance Sheet: Financials. Who owes you: Receivable. What you owe: Payable.', 'Most reports export to PDF or Excel.'],
  ledger: ['The books.', 'General Ledger lists every entry; the superadmin can Edit one (a correction is posted, nothing erased).', 'Month-End Close locks a finished month.'],
  pricing: ['Prices, price tiers and promotions.'],
  costing: ['What each product costs to make, and its margin.'],
  history: ['Shifts and cash drawers.', 'Count the drawer at the end of a shift; differences show here.'],
  approvals: ['Requests waiting for a yes or no.'],
  payroll: ['Pay runs.', 'New run, fill from the timesheet, Add commissions, then save, approve and pay.'],
  timeoff: ['Leave and overtime.', 'File a request; a manager approves it here.'],
  settings: ['Business and device settings.', 'This Device: theme, text size, touch screen.'],
};

export default function HelpTip({ screen }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const tips = SCREEN_TIPS[screen];
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close); window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc); };
  }, [open]);
  if (!tips) return null;
  return (
    <div className="relative shrink-0" ref={ref}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Help for this screen" title="Help for this screen"
        className="flex items-center justify-center bg-white/5 text-fg/75 border border-white/10 p-2 rounded-xl hover:bg-white/10 hover:text-fg transition">
        <HelpCircle size={15} />
      </button>
      {open && (
        <div role="dialog" aria-label="Help for this screen"
          className="fixed right-3 top-16 w-[min(20rem,calc(100vw-1.5rem))] bg-surface border border-white/10 rounded-2xl shadow-elev-3 p-4 z-[9999]">
          <div className="flex items-start justify-between gap-2 mb-2">
            <p className="text-sm font-black text-fg">{tips[0]}</p>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close help" className="text-fg/60 hover:text-fg"><X size={14} /></button>
          </div>
          <ul className="space-y-1.5 list-disc pl-4">
            {tips.slice(1).map((t) => <li key={t} className="text-xs text-fg/80 leading-snug">{t}</li>)}
          </ul>
          <p className="text-[10px] text-fg/55 mt-3">The full user guide has step-by-step instructions.</p>
        </div>
      )}
    </div>
  );
}
