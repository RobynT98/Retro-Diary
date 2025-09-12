const CACHE_NAME = "retro-diary-v2";
const CORE_ASSETS = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "fonts_db.js",
  "manifest.json",
  "sw.js",
  "icon-192.png",
  "icon-512.png",
  "leather.jpg",
  "parchment.jpg"
];

// Install – lägg i cache
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

// Activate – rensa gamla cachar
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)))
    )
  );
  self.clients.claim();
});

// Fetch – försök nät först, annars cache
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Endast egna filer cachas. Externa (YouTube, bilder via URL, ljud mm) släpps igenom.
  if (url.origin === location.origin) {
    event.respondWith(
      fetch(event.request)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return resp;
        })
        .catch(() => caches.match(event.request))
    );
  }
});
