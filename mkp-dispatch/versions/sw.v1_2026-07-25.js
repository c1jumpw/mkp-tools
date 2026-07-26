const CACHE = 'dispatch-shell-v1';
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
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
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
