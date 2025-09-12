// sw.js – Retro Diary
const CACHE_NAME = "retro-diary-v25"; // ändra versionsnummer vid varje uppdatering
const CORE_ASSETS = [
  "/",               // index.html
  "/index.html",
  "/styles.css",
  "/app.js",
  "/fonts_db.js",
  "/manifest.json",
  "/sw.js",
  "/leather.jpg",
  "/parchment.jpg",
  "/icon-192.png",
  "/icon-512.png"
];

// Installera: cacha grundfiler
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

// Aktivera: ta bort gamla cacher
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Hämta: nätverk först, fallback till cache
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Hoppa över tredjepartsresurser (YouTube, Google Fonts, osv)
  if (url.origin !== location.origin) {
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        // Lägg i cache enbart GET-resurser
        if (e.request.method === "GET") {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
