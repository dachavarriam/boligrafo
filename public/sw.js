// v2: SOLO cachea el shell de la app (mismo origen) y SOLO respuestas
// exitosas. Las llamadas a la API de sync nunca se tocan.
const CACHE = 'boligrafo-v2';   // ← bump: purga el caché envenenado

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
  const url = new URL(e.request.url);
  // Regla nueva: si no es GET o no es NUESTRO origen (la API de
  // sync vive en workers.dev), el SW no interviene en absoluto.
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;

  e.respondWith(
    caches.match(e.request).then(
      (hit) =>
        hit ||
        fetch(e.request).then((res) => {
          if (res.ok) {               // ← nunca cachear errores
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
    )
  );
});