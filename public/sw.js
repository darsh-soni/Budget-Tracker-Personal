/* Pocket Ledger service worker: offline viewing + push notifications. */
const VERSION = 'v1';
const STATIC_CACHE = `pl-static-${VERSION}`;
const PAGE_CACHE = `pl-pages-${VERSION}`;
const DATA_CACHE = `pl-data-${VERSION}`;
const PRECACHE = ['/offline', '/manifest.webmanifest', '/icon.svg', '/icons/apple-touch-icon.png', '/icons/icon-192.png'];
// Read-only API responses that are safe to show when offline
const CACHEABLE_API = [/^\/api\/bootstrap/, /^\/api\/transactions(\?|$)/, /^\/api\/rules$/];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.endsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'clear-user-cache') {
    event.waitUntil(Promise.all([caches.delete(DATA_CACHE), caches.delete(PAGE_CACHE)]));
  }
});

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    // never cache redirects (e.g. to /login) or errors
    if (response.ok && !response.redirected) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      networkFirst(request, PAGE_CACHE).catch(async () => {
        // offline: try the cached page ignoring query, then the app shell, then /offline
        const pages = await caches.open(PAGE_CACHE);
        return (
          (await pages.match(request, { ignoreSearch: true })) ||
          (await pages.match('/')) ||
          (await caches.match('/offline'))
        );
      }),
    );
    return;
  }
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/') || url.pathname === '/icon.svg') {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (CACHEABLE_API.some((re) => re.test(url.pathname + url.search))) {
    event.respondWith(networkFirst(request, DATA_CACHE));
  }
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Pocket Ledger', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Pocket Ledger', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag,
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          client.navigate(target).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
