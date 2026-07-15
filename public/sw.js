// Service Worker de Bolígrafo — estrategia "cache-first" para el shell.
// ¿Por qué? Tus TEXTOS viven en IndexedDB (siempre offline).
// El SW solo cachea la app (HTML/JS/CSS/fuentes) para que abra sin internet.
const CACHE = 'boligrafo-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./'])));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(
      (hit) =>
        hit ||
        fetch(e.request).then((res) => {
          // cachea al vuelo lo que se descarga (JS, CSS, fuentes)
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return res;
        }).catch(() => hit)
    )
  );
});
