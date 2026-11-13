/* Semivra Libellus POS — Service Worker
 * Handles: (1) install-to-home-screen offline app shell,
 *          (2) runtime asset caching, (3) push notifications.
 * Bump CACHE_VERSION whenever caching logic changes to force a refresh.
 */
// v4 (2026-11 audit, M110): drops every cache v3 filled, socket.io polls included.
const CACHE_VERSION = 'semivra-v4';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const ASSET_CACHE = `${CACHE_VERSION}-assets`;

// Minimal shell: the app entry + icons. Hashed JS/CSS are cached at runtime.
const SHELL_URLS = [
  '/',
  '/manifest.webmanifest',
  '/logo.png',
  '/icon-192.png',
  '/icon-512.png',
];

// ── INSTALL: precache the shell ──────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: drop stale caches, take control immediately ────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Allow the page to trigger an immediate SW activation after an update.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// Only real static files are kept: the hashed build output and the shell's
// icons/fonts. Anything else on this origin - socket.io long-polling above all,
// which carries live orders and customer details - is never stored (M110).
const STATIC_FILE = /\.(?:js|mjs|css|png|jpe?g|webp|gif|svg|ico|woff2?|ttf|webmanifest)$/i;
const isCacheableAsset = (url) => !url.pathname.startsWith('/socket.io') && STATIC_FILE.test(url.pathname);
const ASSET_CACHE_LIMIT = 150;   // hashed files from old deploys would pile up forever
const trimCache = async (name, max) => {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(k);
};
const isHtmlPage = (res) => !!res && res.ok && (res.headers.get('content-type') || '').includes('text/html');

// ── FETCH: navigation = network-first; assets = stale-while-revalidate ───────
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only GET, only same-origin. API calls (other origin) bypass the SW entirely.
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // never cache API responses
  if (url.pathname.startsWith('/socket.io')) return; // live data, never cached (M110)
  // The update check asks for the live page. Served from the cache, it would
  // always look unchanged and an installed till would never update.
  if (url.searchParams.has('__fresh')) return;

  // App navigations: try network, fall back to cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          // Only a real page becomes the offline shell: a 502 or a proxy's error
          // page saved here would be what the till shows offline (M110).
          if (isHtmlPage(res)) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put('/', copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match('/').then((cached) => cached || caches.match(request)))
    );
    return;
  }

  // Everything else that is not a static file goes straight to the network.
  if (!isCacheableAsset(url)) return;

  // Static assets (JS/CSS/img/fonts): serve cached, refresh in background.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(ASSET_CACHE)
              .then((c) => c.put(request, copy))
              .then(() => trimCache(ASSET_CACHE, ASSET_CACHE_LIMIT))
              .catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

// ── PUSH NOTIFICATIONS (order-ready alerts) ──────────────────────────────────
self.addEventListener('push', function (event) {
  const options = {
    body: event.data ? event.data.text() : 'Your order is ready for pickup!',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [1000, 500, 1000, 500, 2000],
    data: { dateOfArrival: Date.now(), primaryKey: 1 },
  };
  event.waitUntil(self.registration.showNotification('Food is Ready! ☕', options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil(clients.openWindow('/'));
});
