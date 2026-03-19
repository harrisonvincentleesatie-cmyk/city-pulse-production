// City Pulse — Service Worker
// Strategy:
//   - App shell (HTML/JS/CSS): cache-first, update in background
//   - Mapbox tiles/API: always network, never cache (too large, always changing)
//   - Future /api/ calls: always network, never cache

const CACHE_NAME = 'city-pulse-v1';

// ── Install: pre-cache the app entry point ──────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.add('/')).then(() => self.skipWaiting())
  );
});

// ── Activate: delete any old caches from previous versions ──────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: route requests ────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Never intercept Mapbox — tiles, styles, geocoding, all pass through
  if (
    url.hostname.endsWith('mapbox.com') ||
    url.hostname.endsWith('mapbox.cn') ||
    url.hostname.endsWith('tiles.mapbox.com')
  ) {
    return;
  }

  // Never intercept future backend API calls
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Navigation requests (HTML) — network-first, fall back to cached index
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/'))
    );
    return;
  }

  // Static assets (JS, CSS, images, fonts) — cache-first, then network + store
  if (
    request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'image' ||
    request.destination === 'font'
  ) {
    event.respondWith(
      caches.match(request).then(
        cached =>
          cached ||
          fetch(request).then(response => {
            if (response.ok) {
              caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
            }
            return response;
          })
      )
    );
  }
});
