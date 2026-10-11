/**
 * =========================================================================
 * sw.js — service worker: offline app shell + reliable updates
 * =========================================================================
 * PURPOSE
 *   Lets Dispatch It open instantly and work offline, WITHOUT ever getting
 *   stuck on an old version after a deploy. Only same-origin app files
 *   (HTML/CSS/JS/icons) are handled; every Worker/ClickUp API call
 *   bypasses this file entirely and always hits the network.
 *
 * STRATEGY (v3): network-first with a fast cache fallback
 *   1. Try the network (bypassing the HTTP cache) and, on success, update
 *      the cache with the fresh copy.
 *   2. If the network is slow (> NETWORK_TIMEOUT_MS) or down, answer from
 *      the cache instead so the app still opens on a subway.
 *   Result: any deploy shows up on the next open while online — no
 *   reliance on the browser noticing a changed sw.js, which is what kept
 *   phones on stale versions under v2's cache-first strategy (sw.js
 *   itself rarely changed between deploys, so browsers saw nothing new
 *   and kept serving the old cached app.js).
 *
 * -------------------------------------------------------------------------
 * VERSION HISTORY
 *   v1  2026-07-23  Initial cache-first app shell.
 *   v2  2026-07-25  Bumped cache name; install fetches with
 *                    {cache: 'reload'} to bypass the HTTP cache.
 *   v3  2026-10-10  Switched app files to network-first (see STRATEGY) —
 *                    the root-cause fix for "phone still shows the old
 *                    version until site data is cleared". Added the new
 *                    ui.js / routing.js to the shell. Navigation requests
 *                    fall back to the cached index.html offline. Cache
 *                    name bumped to v3 so old caches are cleaned out.
 * =========================================================================
 */

const CACHE = 'dispatch-shell-v3';
// Waiting longer than this for the network makes the app feel broken on
// a weak signal; after it, the cached copy is served immediately (the
// network request still finishes in the background and refreshes the cache).
const NETWORK_TIMEOUT_MS = 3500;
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/config.js',
  './js/storage.js',
  './js/clickup.js',
  './js/ui.js',
  './js/routing.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // {cache: 'reload'} skips the browser HTTP cache so the new service
      // worker starts with genuinely fresh files.
      Promise.all(SHELL.map((url) =>
        fetch(url, { cache: 'reload' }).then((res) => (res.ok ? cache.put(url, res) : null)).catch(() => null)
      ))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/**
 * networkFirst
 * Fresh copy from the network (also refreshing the cache); cached copy
 * if the network fails or takes longer than NETWORK_TIMEOUT_MS.
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  const network = fetch(request, { cache: 'no-store' }).then((res) => {
    // Only cache complete, successful same-origin responses.
    if (res && res.ok && res.type === 'basic') cache.put(request, res.clone());
    return res;
  });
  // If the timeout wins the race below, nobody awaits `network`; this
  // keeps a later failure from surfacing as an unhandled rejection.
  network.catch(() => {});

  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS));
  try {
    const fast = await Promise.race([network, timeout]);
    if (fast) return fast;
  } catch (e) {
    // Network failed outright — fall through to the cache.
  }
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  // Offline navigation to a URL we never cached → serve the app shell.
  if (request.mode === 'navigate') {
    const shell = await cache.match('./index.html');
    if (shell) return shell;
  }
  // Nothing cached: wait for the network after all (may still succeed).
  return network;
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Only same-origin GETs (the app's own files). API calls to the Worker
  // are a different origin and pass straight through, never cached.
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;
  event.respondWith(networkFirst(event.request));
});
