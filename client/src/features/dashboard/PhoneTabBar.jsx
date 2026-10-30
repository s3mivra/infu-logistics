import { Home, ShoppingCart, Package, Bell, Menu } from 'lucide-react';

// Phones only: the screens used most, along the bottom where a thumb reaches.
// Menu opens the full sidebar drawer for everything else; Alerts is Home's
// "Needs your action" list (the bell's count shows on it).
export default function PhoneTabBar({ activeTab, go, can, alertCount = 0, openMenu }) {
  const items = [
    { id: 'home', label: 'Home', Icon: Home, show: true },
    { id: 'orders', label: 'Till', Icon: ShoppingCart, show: can('orders.view') },
    { id: 'inventory', label: 'Stock', Icon: Package, show: can('inventory.view') },
    { id: 'alerts', label: 'Alerts', Icon: Bell, show: true, badge: alertCount },
  ].filter((i) => i.show);
  const cls = (on) => `relative flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-bold ${on ? 'text-brand-text' : 'text-fg/70'}`;
  return (
    <nav aria-label="Quick" className="md:hidden fixed bottom-0 inset-x-0 z-40 flex bg-sidebar-bg border-t border-white/10 pb-[env(safe-area-inset-bottom)]">
      {items.map(({ id, label, Icon, badge }) => {
        const on = id === 'alerts' ? false : activeTab === id;
        return (
          <button key={id} type="button" onClick={() => go(id === 'alerts' ? 'home' : id)} aria-current={on ? 'page' : undefined} className={cls(on)}>
            <Icon size={20} />
            {label}
            {badge > 0 && <span className="absolute top-1 left-1/2 ml-2 min-w-[18px] h-[18px] px-1 rounded-full bg-red-700 text-white text-[9px] font-black flex items-center justify-center">{badge > 99 ? '99+' : badge}</span>}
          </button>
        );
      })}
      <button type="button" onClick={openMenu} className={cls(false)} aria-label="Open navigation">
        <Menu size={20} />
        Menu
      </button>
    </nav>
  );
}
