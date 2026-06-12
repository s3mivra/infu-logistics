/* Semivra Libellus POS — Service Worker
 * Handles: (1) install-to-home-screen offline app shell,
 *          (2) runtime asset caching, (3) push notifications.
 * Bump CACHE_VERSION whenever caching logic changes to force a refresh.
 */
const CACHE_VERSION = 'semivra-v2';
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

// ── FETCH: navigation = network-first; assets = stale-while-revalidate ───────
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only GET, only same-origin. API calls (other origin) bypass the SW entirely.
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // never cache API responses

  // App navigations: try network, fall back to cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put('/', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/').then((cached) => cached || caches.match(request)))
    );
    return;
  }

  // Static assets (JS/CSS/img/fonts): serve cached, refresh in background.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(ASSET_CACHE).then((c) => c.put(request, copy)).catch(() => {});
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
