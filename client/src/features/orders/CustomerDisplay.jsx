import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { API_URL } from '../../shared/apiBase.js';
import { subscribeCart } from '../../shared/customerDisplay';

const peso = (n) => `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// /display - the screen the customer looks at. Same device: open it in a
// second window. Another device: /display?code=XXXXXX with the till's code.
export default function CustomerDisplay() {
  const [state, setState] = useState(null);
  const code = new URLSearchParams(window.location.search).get('code') || '';

  useEffect(() => {
    // Its own anonymous connection: the display is not signed in and only
    // ever joins the pairing room.
    const socket = code ? io(API_URL, { transports: ['websocket', 'polling'] }) : null;
    const off = subscribeCart(setState, { socket, code });
    return () => { off(); socket?.disconnect(); };
  }, [code]);

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
