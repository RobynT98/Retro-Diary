// Retro Diary Service Worker (lite/book)
const CACHE_NAME = "retro-diary-v4";
const ASSETS = [
  "/",             // index.html
  "/index.html",
  "/styles.css",
  "/app.js",
  "/manifest.json",
  "/leather.jpg",
  "/parchment.jpg",
  "/icon-192.png",
  "/icon-512.png"
];

// Install – cacha grundfilerna
self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

// Activate – rensa gamla cache-versioner
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
});

// Fetch – network-first för appfiler, annars cache
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);

  // Endast GET-requests
  if (e.request.method !== "GET") return;

  // För våra egna filer (same-origin)
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          // uppdatera cache
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request)) // fallback: cache
    );
  }
});
