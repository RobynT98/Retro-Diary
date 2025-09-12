// --- Retro Diary Service Worker ---
const CACHE_NAME = "retro-diary-v1.0.0";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=fix1",
  "./app.js?v=fix1",
  "./leather.jpg",
  "./parchment.jpg",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];

// Installera och cachea grundresurser
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Rensa gamla cache-versioner
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)))
      )
  );
  self.clients.claim();
});

// Network-first, fallback till cache
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Hoppa över icke-GET
  if (req.method !== "GET") {
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        // cachea en kopia i bakgrunden
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req))
  );
});
