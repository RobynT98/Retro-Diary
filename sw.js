const CACHE = 'retro-diary-v11'; // bumpa!

self.addEventListener('fetch', e => {
  const dest = e.request.destination;

  // JS & CSS: network-first (annars risk för gammal kod)
  if (dest === 'script' || dest === 'style') {
    e.respondWith(
      fetch(e.request).then(resp => {
        caches.open(CACHE).then(c => c.put(e.request, resp.clone()));
        return resp;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // HTML: network-first (som innan)
  if (e.request.mode === 'navigate' || (e.request.headers.get('accept')||'').includes('text/html')) {
    e.respondWith(
      fetch(e.request).then(resp => {
        caches.open(CACHE).then(c => c.put(e.request, resp.clone()));
        return resp;
      }).catch(() => caches.match(e.request).then(r => r || caches.match('./')))
    );
    return;
  }

  // Övrigt: cache-first
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request)));
});
