/* PWA runtime helpers — service worker registration, install prompt,
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
export async function flushClockQueue(sender) {
  const q = getQueuedClock();
  if (!q.length) return { sent: 0 };
  let sent = 0; const survivors = [];
  for (const e of q) {
    try { (await sender(e)) ? sent++ : survivors.push(e); } catch { survivors.push(e); }
  }
  localStorage.setItem(CLOCK_QUEUE_KEY, JSON.stringify(survivors));
  return { sent, remaining: survivors.length };
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
export function queueOrder(payload, id) {
  const queue = getQueuedOrders();
  const entryId = id || `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  if (queue.some(e => e.id === entryId)) return queue.length; // already queued — don't double
  queue.push({ id: entryId, payload, queuedAt: Date.now() });
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  return queue.length;
}

function setQueue(queue) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

/**
 * Replay every queued order through the provided sender.
 * `sender(entry)` receives the full queue entry ({ id, payload, queuedAt }) and
 * must return a truthy value on success (it is awaited). The stable `entry.id`
 * doubles as an idempotency key so a mid-flush network flap can't duplicate an
 * order. Successfully-sent orders are removed; failures stay for the next flush.
 * A simple in-flight guard prevents concurrent flushes racing the same queue.
 */
let _flushing = false;
export async function flushQueue(sender) {
  if (_flushing) return { sent: 0, remaining: getQueuedOrders().length };
  _flushing = true;
  try {
    const queue = getQueuedOrders();
    if (queue.length === 0) return { sent: 0, remaining: 0 };
    let sent = 0;
    const survivors = [];
    for (const entry of queue) {
      try {
        const ok = await sender(entry);
        if (ok) { sent++; } else { survivors.push(entry); }
      } catch {
        survivors.push(entry);
      }
    }
    setQueue(survivors);
    return { sent, remaining: survivors.length };
  } finally {
    _flushing = false;
  }
}
