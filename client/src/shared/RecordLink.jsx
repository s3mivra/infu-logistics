import { useContext } from 'react';
import DashboardContext from '../features/dashboard/DashboardContext';
import { noteRecent } from './recent';

// A client name or order number in a report or list that opens it: the
// Clients screen searched to that client, or Orders & POS searched to that
// order. Plain text outside the dashboard, or for someone who cannot open
// that screen.
export default function RecordLink({ kind, value, children, className = '' }) {
  const ctx = useContext(DashboardContext);
  const text = children ?? value;
  const perm = kind === 'client' ? 'orders.view' : 'orders.view';
  if (!ctx || !value || (ctx.can && !ctx.can(perm))) return <span className={className}>{text}</span>;
  const open = (e) => {
    e.stopPropagation();
    noteRecent({ type: kind, value: String(value) });
    if (kind === 'client') {
      try { sessionStorage.setItem('clients.find', String(value)); } catch { /* opens unsearched */ }
      ctx.setActiveTab('clients');
    } else {
      ctx.setOrderFilter?.('All');
      ctx.setOrderSearch?.(String(value));
      ctx.setActiveTab('orders');
    }
  };
  return (
    <button type="button" onClick={open} title={kind === 'client' ? `Open ${value}` : `Open order ${value}`}
      className={`text-left hover:underline underline-offset-2 decoration-brand/60 ${className}`}>
      {text}
    </button>
  );
}
