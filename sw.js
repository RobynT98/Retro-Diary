/* sw.js — Retro Diary */
const CACHE_NAME = 'retro-diary-v17';
const CORE_ASSETS = [
  '/',              // om du serverar index på rotnivå
  '/index.html',
  '/styles.css',
  '/app.js?v=17',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

// Hjälpare: avgör om vi ska köra network-first
function isNetworkFirst(req) {
  const url = new URL(req.url);
  // Kör network-first för kärn-koden
  return url.pathname.endsWith('/app.js') || url.pathname.includes('app.js?v=') ||
         url.pathname.endsWith('/styles.css');
}

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE_ASSETS.map(p => new Request(p, { cache: 'reload' })));
    // Skippar vänteläge så nya SW tar över tidigare
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // Städa gamla cachear
    const keys = await caches.keys();
    await Promise.all(keys.map(k => k !== CACHE_NAME && caches.delete(k)));
    // Gör nya SW aktiv direkt
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;

  // Bara GET requests cachas
  if (req.method !== 'GET') return;

  // Network-first för app.js/styles.css
  if (isNetworkFirst(req)) {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: 'no-store' });
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(req, { ignoreSearch: false }) || await cache.match(stripQuery(req));
        return cached || new Response('Offline och ingen cache för koden.', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }

  // Cache-first för annat (ikoner, manifest, bilder, fonter mm)
  e.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req, { ignoreSearch: false }) || await cache.match(stripQuery(req));
    if (cached) return cached;
    try {
      const fresh = await fetch(req);
      // Cacha bara ok svar (200) och basic (samma origin) för säkerhets skull
      if (fresh.ok && (fresh.type === 'basic' || fresh.type === 'cors')) {
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch {
      // Minimal offline fallback
      if (req.destination === 'document') {
        // Ge vår index vid offline om vi inte hittar sidan
        const fallback = await cache.match('/index.html');
        if (fallback) return fallback;
      }
      return new Response('Offline.', { status: 503, statusText: 'Offline' });
    }
  })());
});

// Hjälpare: matcha path utan querystring
function stripQuery(req) {
  const url = new URL(req.url);
  url.search = '';
  return new Request(url.toString(), { headers: req.headers, method: req.method, mode: req.mode, credentials: req.credentials, redirect: req.redirect, referrer: req.referrer, referrerPolicy: req.referrerPolicy });
}
