// Offline support. This file is a template: at build time the Vite plugin in
// vite.config.ts fills in the precache list and version and emits it as sw.js.
// It isn't used in dev (`npm run dev`).
//
// Strategy:
// - Install: precache the app shell (HTML, JS, CSS, Latin fonts, icons).
// - Page loads (navigations): network first, so a new deploy shows up the next
//   time the app opens; fall back to the cached page when offline.
// - Everything else: cache first (built assets have hashed, immutable names),
//   caching anything new as it's fetched.
//
// Bypass the browser's HTTP cache for the page. GitHub Pages sends
// `Cache-Control: max-age=600`, so a plain fetch() can return the previous
// deploy's index.html for up to 10 minutes. That page points at the previous
// JS, so a fresh deploy looked like it hadn't arrived. `cache: 'no-cache'`
// always revalidates with the server (a cheap 304 when nothing changed), and
// precaching uses `cache: 'reload'` so it never stores a stale copy.

const PRECACHE = __PRECACHE__;
const CACHE = 'emilys-timer-' + __VERSION__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-cache' })
        .then((response) => {
          // Only keep real pages as the offline copy, never an error page.
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put('./', copy));
          }
          return response;
        })
        .catch(() => caches.match('./', { ignoreVary: true })),
    );
    return;
  }

  // ignoreVary: servers often send "Vary: Origin" or "Vary: Accept-Encoding",
  // which would stop cached JS/CSS (loaded in CORS mode) from matching offline.
  // Safe here because these are static files with content-hashed names.
  event.respondWith(
    caches.match(request, { ignoreVary: true }).then(
      (cached) =>
        cached ??
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
