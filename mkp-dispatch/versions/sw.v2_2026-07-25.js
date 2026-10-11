/**
 * =========================================================================
 * sw.js — service worker: offline app-shell caching + update handling
 * =========================================================================
 * PURPOSE
 *   Caches the core app files so Dispatch loads instantly and works
 *   offline. Deliberately narrow scope: only the app shell (HTML/CSS/
 *   JS/icons) is cached — every ClickUp/Worker API call bypasses this
 *   entirely and always hits the network (see the fetch handler).
 *
 * WHY THE UPDATE HANDLING MATTERS
 *   As an installed home-screen PWA, there's no browser chrome/pull-
 *   to-refresh to fall back on, and browsers only check for a new
 *   service worker on certain navigation events — which barely happen
 *   in a standalone-mode app someone just re-opens from their home
 *   screen. Without deliberate handling, a phone can keep serving a
 *   stale cached version indefinitely even after a real deploy. Two
 *   things address this together:
 *     1. CACHE is versioned (bump the suffix on every deploy) — a
 *        version bump alone forces a byte-diff the browser will
 *        eventually notice and makes `activate` clean out the old
 *        cache immediately once it does.
 *     2. app.js's "Check for updates" button (Home screen) calls
 *        registration.update() on demand — forces an immediate check
 *        rather than waiting on the browser's own schedule, then
 *        reloads once the new service worker (skipWaiting below means
 *        it activates immediately, no extra tabs/closes needed) is in
 *        control.
 *
 * -------------------------------------------------------------------------
 * VERSION HISTORY
 *   v1  2026-07-23  Initial cache-first app shell.
 *   v2  2026-07-25  Bumped cache name (v1 → v2) as part of shipping
 *                    the manual update-check flow. Install now fetches
 *                    each shell file with {cache: 'reload'}, bypassing
 *                    the browser's own HTTP cache — without this, a
 *                    forced service-worker update could still populate
 *                    its cache from stale HTTP-cached responses rather
 *                    than genuinely fresh ones.
 * =========================================================================
 */

const CACHE = 'dispatch-shell-v2';
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/config.js',
  './js/storage.js',
  './js/clickup.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // {cache: 'reload'} bypasses the browser's HTTP cache for each
      // request — without it, a forced update (see app.js checkForUpdates)
      // could still populate the new service-worker cache from stale
      // HTTP-cached files, defeating the whole point of forcing an update.
      Promise.all(SHELL.map((url) => fetch(url, { cache: 'reload' }).then((res) => cache.put(url, res))))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// App-shell files: cache-first. Everything else (ClickUp/API calls):
// always go to the network — never cache or intercept those.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // let API calls pass straight through

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
