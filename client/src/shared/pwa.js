/* PWA runtime helpers - service worker registration, install prompt,
 * online/offline status, and an offline order queue.
 * Pure browser logic, no React; consumed by a hook in usePwa.js. */

// ── Service worker registration ──────────────────────────────────────────────
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // Register after load so it never competes with first paint.
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('SW registration failed:', err);
    });
  });
}

// ── Install prompt capture ───────────────────────────────────────────────────
// The browser fires `beforeinstallprompt`; we stash it so a custom button can
// trigger installation on demand.
let deferredInstallPrompt = null;
const installListeners = new Set();

export function initInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    installListeners.forEach((fn) => fn(true));
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    installListeners.forEach((fn) => fn(false));
  });
}

export function canInstall() {
  return !!deferredInstallPrompt;
}

export function onInstallAvailabilityChange(fn) {
  installListeners.add(fn);
  return () => installListeners.delete(fn);
}

export async function promptInstall() {
  if (!deferredInstallPrompt) return false;
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  installListeners.forEach((fn) => fn(false));
  return outcome === 'accepted';
}

// ── Offline clock-in/out queue ───────────────────────────────────────────────
// Clock events made offline are stored with their real timestamp and replayed
// (in order) when back online, so payroll hours stay accurate.
const CLOCK_QUEUE_KEY = 'semivra_offline_clock';
export function getQueuedClock() {
  try { return JSON.parse(localStorage.getItem(CLOCK_QUEUE_KEY) || '[]'); } catch { return []; }
}
export function queueClock(type) { // type: 'in' | 'out' | 'break-start' | 'break-end'
  const q = getQueuedClock();
  q.push({ id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, type, at: new Date().toISOString() });
  localStorage.setItem(CLOCK_QUEUE_KEY, JSON.stringify(q));
  return q.length;
}
// Replays IN ORDER and stops at the first event that does not go through:
// sending a clock-out while the clock-in before it failed would record the
// shift backwards. Only events actually sent are removed, from a fresh read,
// so one clocked while this was running is not erased.
let _clockFlushing = false;
export async function flushClockQueue(sender) {
  if (_clockFlushing) return { sent: 0, remaining: getQueuedClock().length };
  _clockFlushing = true;
  try {
    const q = getQueuedClock();
    if (!q.length) return { sent: 0, remaining: 0 };
    const sentIds = new Set();
    for (const e of q) {
      let ok = false;
      try { ok = !!(await sender(e)); } catch { ok = false; }
      if (!ok) break;
      sentIds.add(e.id);
    }
    const now = getQueuedClock().filter(e => !sentIds.has(e.id));
    localStorage.setItem(CLOCK_QUEUE_KEY, JSON.stringify(now));
    return { sent: sentIds.size, remaining: now.length };
  } finally {
    _clockFlushing = false;
  }
}

// ── Notifications ────────────────────────────────────────────────────────────
// Ask once for permission; show alerts via the service worker so they appear even
// when the installed app is backgrounded.
export async function requestNotificationPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try { return (await Notification.requestPermission()) === 'granted'; } catch { return false; }
}

export async function notify(title, body, opts = {}) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const options = { body, icon: '/icon-192.png', badge: '/icon-192.png', vibrate: [200, 100, 200], ...opts };
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg?.showNotification) await reg.showNotification(title, options);
    else new Notification(title, options);
  } catch { /* ignore */ }
}

// ── Offline order queue ──────────────────────────────────────────────────────
// Orders placed while offline are stashed in localStorage and replayed when the
// connection returns. Keeps the cafe taking orders even when WiFi drops.
const QUEUE_KEY = 'semivra_offline_orders';

export function getQueuedOrders() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); }
  catch { return []; }
}

// Optional `id` lets the caller reuse a prior idempotency key (e.g. an online
// submit that failed mid-request) so replay can't duplicate a half-sent order.
// Queued sales are paid-for orders that exist nowhere else yet. Ask the
// browser to keep this site's storage rather than clear it under disk
// pressure (a tablet low on space evicts "best effort" storage first). Asked
// once per page, when the first order is queued; a refusal changes nothing.
let persistAsked = false;
function askToPersist() {
  if (persistAsked) return;
  persistAsked = true;
  try { globalThis.navigator?.storage?.persist?.().catch(() => {}); } catch { /* not supported */ }
}

// ── IndexedDB copy of the offline order queue ────────────────────────────────
// localStorage stays the working copy (synchronous, so a sale is queued before
// the checkout handler returns), but it is small and the first thing a browser
// clears. Every queued order is also written to IndexedDB, and on start-up
// anything there that localStorage lost is put back. Entries keep their id,
// which is the Idempotency-Key the server dedupes on, so restoring an order
// that did in fact reach the server replays the original sale - never a second.
const IDB_NAME = 'semivra_offline';
const IDB_STORE = 'orders';
let _idb = null;
function openIdb() {
  if (_idb) return _idb;
  _idb = new Promise((resolve) => {
    try {
      const idb = globalThis.indexedDB;
      if (!idb) return resolve(null);
      const req = idb.open(IDB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(IDB_STORE, { keyPath: 'id' }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
  return _idb;
}
async function idbDo(mode, fn) {
  const db = await openIdb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, mode);
      const out = fn(tx.objectStore(IDB_STORE));
      tx.oncomplete = () => resolve(out?.result ?? true);
      tx.onerror = tx.onabort = () => resolve(null);
    } catch { resolve(null); }
  });
}
function idbPut(entry) { return idbDo('readwrite', st => { st.put(entry); }); }
function idbDelete(ids) { return idbDo('readwrite', st => { ids.forEach(id => st.delete(id)); }); }

// Put back any queued order localStorage lost. Returns how many came back.
export async function restoreQueueFromIdb() {
  const all = await idbDo('readonly', st => st.getAll());
  if (!Array.isArray(all) || !all.length) return 0;
  const queue = getQueuedOrders();
  const rejected = new Set(getRejectedOrders().map(e => e.id));
  const have = new Set(queue.map(e => e.id));
  const back = all.filter(e => !have.has(e.id) && !rejected.has(e.id));
  if (!back.length) return 0;
  const merged = [...queue, ...back].sort((a, b) => (a.queuedAt || 0) - (b.queuedAt || 0));
  localStorage.setItem(QUEUE_KEY, JSON.stringify(merged));
  return back.length;
}

export function queueOrder(payload, id) {
  askToPersist();
  const queue = getQueuedOrders();
  const entryId = id || `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  if (queue.some(e => e.id === entryId)) return queue.length; // already queued - don't double
  const entry = { id: entryId, payload, queuedAt: Date.now() };
  queue.push(entry);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  idbPut(entry);
  return queue.length;
}

// Orders the SERVER refused (not network failures) - kept apart so they stop
// being retried and a person can see them. Before this, a refusal looked the
// same as "offline", so a paid sale could sit on the tablet forever, retried
// every few seconds, with nothing on screen to say it was never recorded.
const REJECTED_KEY = 'semivra_offline_rejected';
export function getRejectedOrders() {
  try { return JSON.parse(localStorage.getItem(REJECTED_KEY) || '[]'); }
  catch { return []; }
}
export function dismissRejectedOrder(id) {
  localStorage.setItem(REJECTED_KEY, JSON.stringify(getRejectedOrders().filter(e => e.id !== id)));
}

// What a sender reports for one entry:
//   'sent'      the server has it - drop it
//   'rejected'  the server refused it (4xx): stop retrying, show it to a person
//   anything else (false, 'retry', a throw) - offline or a server fault: keep it
export const SENT = 'sent';
export const REJECTED = 'rejected';

/**
 * Replay every queued order through `sender(entry)`.
 *
 * The queue is re-read at the END and only the entries this flush actually
 * settled are removed. It used to overwrite the whole queue with the
 * survivors it computed at the START - so an order queued while a flush was
 * in progress was silently erased: a lost sale.
 */
let _flushing = false;
export async function flushQueue(sender) {
  if (_flushing) return { sent: 0, rejected: 0, remaining: getQueuedOrders().length };
  _flushing = true;
  try {
    const snapshot = getQueuedOrders();
    if (snapshot.length === 0) return { sent: 0, rejected: 0, remaining: 0 };
    const settled = new Set();
    const refused = [];
    let sent = 0;
    for (const entry of snapshot) {
      let outcome;
      try { outcome = await sender(entry); } catch { outcome = 'retry'; }
      // `true` is accepted as sent for callers written before outcomes existed.
      if (outcome === SENT || outcome === true) { sent++; settled.add(entry.id); }
      else if (outcome && typeof outcome === 'object' && outcome.status === REJECTED) {
        settled.add(entry.id);
        refused.push({ ...entry, rejectedAt: Date.now(), reason: outcome.reason || 'Refused by the server.' });
      }
    }
    // Re-read: anything queued during the awaits above is still there.
    const now = getQueuedOrders().filter(e => !settled.has(e.id));
    localStorage.setItem(QUEUE_KEY, JSON.stringify(now));
    if (settled.size) await idbDelete([...settled]);
    if (refused.length) {
      localStorage.setItem(REJECTED_KEY, JSON.stringify([...getRejectedOrders(), ...refused]));
    }
    return { sent, rejected: refused.length, remaining: now.length };
  } finally {
    _flushing = false;
  }
}
