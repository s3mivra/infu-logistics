// The one live connection a signed-in staff screen uses.
//
// It used to live inside AdminDashboard, and the Clients tab opened a second
// one of its own the moment it loaded - with no sign-in token. The server only
// puts a connection in the staff rooms when its handshake carries a valid
// token, so that second connection was never told about order changes, and the
// Clients tab's "live" balances never moved. Every staff screen now shares
// this one.
import { io } from 'socket.io-client';
import * as auth from '../features/auth/auth';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://192.168.100.2:5002';

// transports: WebSocket first, then long-polling as a fallback. It used to be
// websocket-only with upgrade:false, which meant that if anything between the
// browser and the server declined to forward the upgrade - a proxy, a CDN, a
// captive network - realtime did not degrade, it simply died, silently: no new
// orders appearing, no stock updates, and nothing on screen saying so. Polling
// is heavier, so it is the fallback rather than the default.
export const socket = io(API_URL, {
  transports: ['websocket', 'polling'],
  // A token that is fresh at the moment of the handshake. The server reads the
  // token once, when the connection opens, and an expired one is treated as
  // nobody - no rooms, no live orders, and no error to say so. That is what a
  // tablet coming back after fifteen minutes away used to get.
  auth: (cb) => {
    auth.freshToken(API_URL)
      .then((token) => cb({ token: token || '' }))
      .catch(() => cb({ token: auth.getToken?.() || '' }));
  },
  // Not until somebody is signed in. Connecting the moment the page loaded
  // opened a handshake with no session behind it, which sign-in then tore
  // down half-way to reconnect with one - "WebSocket is closed before the
  // connection is established" on every load, and a wasted connection.
  autoConnect: false,
});

// Connect, or reconnect so the handshake carries whoever is signed in NOW.
// The server places a connection in its rooms from the token it saw at the
// handshake, so a PIN switch that kept the old connection left the tablet
// receiving the previous person's live updates. A connection still mid-
// handshake is left to finish and then renewed, rather than cut off.
export function reconnectSocket() {
  try {
    if (socket.connected) { socket.disconnect(); socket.connect(); return; }
    if (socket.active) { socket.once('connect', () => { socket.disconnect(); socket.connect(); }); return; }
    socket.connect();
  } catch { /* realtime is a convenience; the page works without it */ }
}

// Connection failures were completely invisible: there was no connect_error
// handler anywhere in the app, so a socket that could never establish just left
// the dashboard quietly not-live. Logged with the transport that failed,
// because "websocket failed, polling worked" is the signature of a proxy that
// will not forward an upgrade.
socket.on('connect_error', (err) => {
  console.warn('[socket] connect failed:', err?.message || err, '| transport:', socket.io?.engine?.transport?.name || 'unknown');
});

// The back-forward cache. Chrome will not freeze a page holding a socket, so
// leaving the page (or backgrounding the installed app) closes it for us and
// logs "WebSocket connection failed: Page entered Back-Forward Cache" once for
// every attempt in flight. Closing it ourselves first - connected OR still
// trying - is the clean version of the same thing; coming back reopens it,
// with a fresh token, if it was open before.
let resumeOnShow = false;
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    try {
      resumeOnShow = socket.active;
      if (socket.active) socket.disconnect();
    } catch { /* already gone */ }
  });
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted || !resumeOnShow) return;
    resumeOnShow = false;
    try { socket.connect(); } catch { /* ignore */ }
  });
}
