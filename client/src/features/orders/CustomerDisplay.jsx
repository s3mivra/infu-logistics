import { useEffect, useState } from 'react';
import { formatPeso } from '../../shared/money.js';
import { io } from 'socket.io-client';
import { API_URL } from '../../shared/apiBase.js';
import { subscribeCart } from '../../shared/customerDisplay';

const peso = formatPeso;
// /display - the screen the customer looks at. Same device: open it in a
// second window. Another device: /display?code=XXXXXX with the till's code.
// Two views, picked on the till:
//   /display            - the order being rung up, with prices;
//   /display?view=queue - the Now Serving board: Preparing and Ready orders.
export default function CustomerDisplay() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code') || '';
  const view = params.get('view') === 'queue' ? 'queue' : 'cart';
  const [cart, setCart] = useState(null);
  const [queue, setQueue] = useState(null);

  useEffect(() => {
    // Its own anonymous connection: the display is not signed in and only
    // ever joins the pairing room.
    const socket = code ? io(API_URL, { transports: ['websocket', 'polling'] }) : null;
    const off = subscribeCart((s) => {
      if (s?.kind === 'queue') setQueue(s);
      else setCart(s);
    }, { socket, code });
    return () => { off(); socket?.disconnect(); };
  }, [code]);

  return view === 'queue' ? <QueueBoard state={queue} /> : <CartView state={cart} />;
}

function CartView({ state }) {
  const items = state?.items || [];
  return (
    <div data-testid="customer-display" className="min-h-screen bg-page-bg text-fg flex flex-col p-6 md:p-10">
      <h1 className="text-2xl md:text-4xl font-black mb-6">{state?.business || 'Welcome'}</h1>
      {items.length === 0 ? (
        <p className="flex-1 grid place-items-center text-fg/60 text-xl">Your items will appear here.</p>
      ) : (
        <ul className="flex-1 space-y-3 overflow-auto">
          {items.map((it, i) => (
            <li key={i} className="flex justify-between gap-4 text-lg md:text-2xl border-b border-white/10 pb-2">
              <span>
                <span className="font-black">{it.quantity}×</span> {it.name}
                {it.addOns?.length > 0 && <span className="block text-sm text-fg/60">{it.addOns.join(', ')}</span>}
              </span>
              <span className="font-bold tabular-nums">{peso(it.lineTotal)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-6 space-y-1 text-lg md:text-2xl">
        {state?.discount > 0 && <div className="flex justify-between text-fg/70"><span>Discount</span><span className="tabular-nums">-{peso(state.discount)}</span></div>}
        <div className="flex justify-between font-black text-3xl md:text-5xl">
          <span>Total</span><span data-testid="display-total" className="tabular-nums">{peso(state?.total)}</span>
        </div>
      </div>
    </div>
  );
}

function QueueBoard({ state }) {
  const Column = ({ title, list, tone, testid }) => (
    <section data-testid={testid} className="flex flex-col min-h-0 rounded-2xl border border-white/10 bg-surface p-4 md:p-6">
      <h2 className={`text-2xl md:text-4xl font-black uppercase tracking-wider mb-4 ${tone}`}>{title}</h2>
      {list.length === 0 ? (
        <p className="text-fg/50 text-lg md:text-xl">-</p>
      ) : (
        <ul className="grid grid-cols-2 xl:grid-cols-3 gap-3 overflow-auto content-start">
          {list.map((o, i) => (
            <li key={`${o.number}-${i}`} className="rounded-xl bg-white/5 px-3 py-3 text-center">
              <span className="block text-3xl md:text-5xl font-black tabular-nums">{o.number}</span>
              {o.name && <span className="block text-sm md:text-lg text-fg/70 truncate">{o.name}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
  return (
    <div data-testid="queue-display" className="min-h-screen bg-page-bg text-fg flex flex-col p-4 md:p-8 gap-4">
      <h1 className="text-2xl md:text-4xl font-black">{state?.business || 'Welcome'}</h1>
      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 min-h-0">
        <Column title="Preparing" list={state?.preparing || []} tone="text-warning" testid="queue-preparing" />
        <Column title="Now serving" list={state?.ready || []} tone="text-success" testid="queue-ready" />
      </div>
    </div>
  );
}
