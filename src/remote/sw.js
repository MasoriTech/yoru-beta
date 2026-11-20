'use strict';
// Shell offline do PWA. Dados e comandos da API nunca entram no cache.
const CACHE = 'yoru-remote-__BUILD__';
const SHELL = [
  '/', '/app.css', '/app.js', '/manifest.webmanifest',
  '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png',
  '/reactions/aguardando.webp'
];
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map(async (url) => {
      try { const response = await fetch(url, { cache: 'reload' }); if (response.ok) await cache.put(url, response); } catch (_) { /* instalação tolerante a recursos opcionais */ }
    }));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith('yoru-remote-') && key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('message', (event) => { if (event.data === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  // Navegação: rede primeiro para entregar HTML atualizado; cache como fallback offline.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) (await caches.open(CACHE)).put('/', response.clone());
        return response;
      } catch (_) { return (await caches.match('/') || Response.error()); }
    })());
    return;
  }
  const update = fetch(request).then(async (response) => {
    if (response.ok && response.type === 'basic') (await caches.open(CACHE)).put(request, response.clone());
    return response;
  });
  event.waitUntil(update.then(() => {}).catch(() => {}));
  event.respondWith(caches.match(request).then((cached) => cached || update).catch(() => Response.error()));
});
