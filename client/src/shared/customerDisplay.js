// Customer-facing display: a screen turned toward the customer that mirrors
// the cart being rung up. Two ways to reach it:
//   - the same device (a second monitor): BroadcastChannel, no network at all,
//     so it keeps working while offline;
//   - another device (a tablet on the counter): the socket.io room named by a
//     pairing code the till makes up. Only a signed-in till may publish.

export const DISPLAY_CHANNEL = 'semivra-customer-display';
const CODE_KEY = 'semivra_display_code';

let channel = null;
function getChannel() {
  if (channel) return channel;
  try { channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(DISPLAY_CHANNEL) : null; } catch { channel = null; }
  return channel;
}

// The till's pairing code, made once and remembered.
export function getDisplayCode() {
  try {
    let c = localStorage.getItem(CODE_KEY);
    if (!c || !/^[A-Za-z0-9]{6,32}$/.test(c)) {
      const bytes = new Uint8Array(6);
      crypto.getRandomValues(bytes);
      c = Array.from(bytes, b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
      localStorage.setItem(CODE_KEY, c);
    }
    return c;
  } catch {
    return null;
  }
}

// Only what the customer should see - names, quantities, amounts.
export function displayState({ cart = [], subtotal = 0, discount = 0, total = 0, business = '' } = {}) {
  return {
    kind: 'cart',
    business,
    items: cart.map(it => ({
      name: it.name,
      quantity: it.quantity,
      addOns: (it.selectedAddOns || []).map(a => a.name),
      lineTotal: (Number(it.price || 0) + (it.selectedAddOns || []).reduce((s, a) => s + Number(a.price || 0), 0)) * (it.quantity || 0),
    })),
    subtotal, discount, total,
    at: Date.now(),
  };
}

// The Now Serving board (/display?view=queue): which open orders are being
// prepared and which are ready to collect. Only the order number and the
// customer's first name go out - this screen faces the room.
const firstName = (s) => {
  const n = String(s || '').trim();
  return /^walk[- ]?in/i.test(n) ? '' : n.split(/\s+/)[0].slice(0, 16);
};
export function queueState(orders = [], business = '') {
  const preparing = [], ready = [];
  for (const o of orders) {
    if (!['Pending', 'Preparing', 'Ready'].includes(o.status) || o.isParked) continue;
    const items = (o.items || []).filter(i => i.itemStatus !== 'Cancelled');
    if (items.length && items.every(i => i.itemStatus === 'Delivered')) continue;
    const allDone = items.length > 0 && items.every(i => i.itemStatus === 'Finished' || i.itemStatus === 'Delivered');
    const started = o.status !== 'Pending' || items.some(i => i.itemStatus && i.itemStatus !== 'Received');
    const entry = { number: String(o.orderNumber || '').split('-').pop(), name: firstName(o.customerName), at: o.createdAt };
    if (o.status === 'Ready' || allDone) ready.push(entry);
    else if (started) preparing.push(entry);
  }
  const byTime = (a, b) => new Date(a.at) - new Date(b.at);
  return { kind: 'queue', business, preparing: preparing.sort(byTime).slice(0, 30), ready: ready.sort(byTime).slice(0, 30), at: Date.now() };
}

// Send the cart (or the queue board) to every display. `socket` is the till's signed-in socket.
export function publishCart(state, socket) {
  try { getChannel()?.postMessage(state); } catch { /* channel closed */ }
  try {
    const code = getDisplayCode();
    if (socket?.connected && code) socket.emit('display:cart', { code, state });
  } catch { /* realtime is a convenience */ }
}

// Listen for cart updates. Returns an unsubscribe function.
export function subscribeCart(onState, { socket, code } = {}) {
  const ch = getChannel();
  const onMsg = (e) => onState(e.data);
  ch?.addEventListener('message', onMsg);
  const onSocket = (state) => onState(state);
  const join = () => socket.emit('display:join', code);
  if (socket && code) {
    socket.on('display:cart', onSocket);
    socket.on('connect', join);
    if (socket.connected) join();
  }
  return () => {
    ch?.removeEventListener('message', onMsg);
    if (socket && code) { socket.off('display:cart', onSocket); socket.off('connect', join); }
  };
}
