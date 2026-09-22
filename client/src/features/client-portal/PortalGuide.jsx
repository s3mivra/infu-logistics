import { useState } from 'react';
import { Search, Plus, ShoppingCart, CreditCard, Package, ChevronDown, ChevronUp, HelpCircle } from 'lucide-react';

// "How to order" - the portal's tutorial. It is only shown while the order is
// still empty: once something is in the cart the client is already doing it,
// and the guide gets out of the way. Collapsing it is remembered on this device,
// but it never disappears for good - an empty order always offers the way in.

const KEY = 'portal.guideCollapsed';
const readCollapsed = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
const writeCollapsed = (v) => { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* private mode */ } };

export function guideSteps({ quoteOnly, showPrices, hasQr }) {
  return [
    {
      icon: Search,
      title: 'Find it',
      text: 'Type a product name or code in the search bar, or tap a category to narrow the list.',
    },
    {
      icon: Plus,
      title: 'Add it',
      text: 'Tap + on a product to add one. Tap the product itself to see its photo first.',
    },
    {
      icon: ShoppingCart,
      title: 'Check your order',
      text: `Tap the bar at the bottom to open your order and set how many of each${showPrices ? '; the estimated total is shown there' : ''}.`,
    },
    quoteOnly
      ? {
          icon: CreditCard,
          title: 'Request a quote',
          text: 'Add any notes, then tap Request a Quote. Nothing is charged: we price it and send it back for you to accept.',
        }
      : {
          icon: CreditCard,
          title: 'Pay and send',
          text: (hasQr
            ? 'Pick how you will pay. Paying by QR? Tap Pay Now, scan, then type the reference number your app shows. '
            : 'Pick how you will pay and add any notes. ')
            + 'Paying by check? Type its number and date. Then tap Place Order.',
        },
    {
      icon: Package,
      title: 'Track it',
      text: 'Open My orders (the box icon, or the menu on a phone) to follow each order, view or download its slip, and tap "I received my order" when it arrives.',
    },
  ];
}

export default function PortalGuide({ quoteOnly, showPrices, hasQr }) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggle = () => setCollapsed((c) => { writeCollapsed(!c); return !c; });
  const steps = guideSteps({ quoteOnly, showPrices, hasQr });

  return (
    <div className="px-3 sm:px-4 pt-3">
      <section aria-labelledby="portal-guide-title" className="bg-sidebar-bg border border-brand/30 rounded-2xl">
        <button type="button" onClick={toggle} aria-expanded={!collapsed}
          className="w-full flex items-center gap-2 px-4 py-3 text-left">
          <HelpCircle size={15} className="text-brand-text shrink-0" />
          <span id="portal-guide-title" className="flex-1 text-fg font-black text-sm">
            How to {quoteOnly ? 'request a quote' : 'order'}
          </span>
          <span className="text-fg/65 text-[11px] font-bold">{collapsed ? 'Show' : 'Hide'}</span>
          {collapsed ? <ChevronDown size={15} className="text-fg/65" /> : <ChevronUp size={15} className="text-fg/65" />}
        </button>
        {!collapsed && (
          // A swipeable row on a phone, so the guide does not push the products
          // off the screen; a grid once there is room.
          <ol className="flex gap-2 overflow-x-auto snap-x snap-mandatory scrollbar-hide px-3 pb-3 sm:grid sm:grid-cols-2 sm:overflow-visible lg:grid-cols-5">
            {steps.map((s, i) => (
              <li key={s.title} className="snap-start shrink-0 w-[80%] sm:w-auto flex gap-3 lg:flex-col lg:gap-2 bg-white/5 border border-white/10 rounded-xl p-3">
                <div className="flex items-center gap-2 shrink-0">
                  <span className="w-6 h-6 rounded-full bg-brand text-on-brand text-[11px] font-black flex items-center justify-center">{i + 1}</span>
                  <s.icon size={15} className="text-brand-text hidden lg:block" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="text-fg font-bold text-xs">{s.title}</p>
                  <p className="text-fg/75 text-[11px] leading-snug mt-0.5">{s.text}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
