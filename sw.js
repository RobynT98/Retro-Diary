const CACHE = 'retro-diary-v6';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // HTML: network-first
  if (e.request.mode === 'navigate' || (e.request.headers.get('accept')||'').includes('text/html')) {
    e.respondWith(
      fetch(e.request).then(resp=>{ caches.open(CACHE).then(c=>c.put(e.request, resp.clone())); return resp; })
        .catch(()=>caches.match(e.request).then(r=>r || caches.match('./')))
    );
    return;
  }
  // övrigt: cache-first
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request)));
});
