// ---- Retro Diary Service Worker ----
// Bumpa versionen när du ändrar filer:
const CACHE_VER  = "v3";                         // ändra t.ex. till v4 vid uppdatering
const CACHE_NAME = `retro-diary-${CACHE_VER}`;

const ASSETS = [
  "./",
  "./index.html",

  // Stilar
  "./styles.css",
  "./modern.css",
  "./theme_light.css",
  "./theme_dark.css",

  // JS-moduler
  "./fonts_db.js",
  "./crypto.js",
  "./storage.js",
  "./lock.js",
  "./editor.js",
  "./memory.js",
  "./app.js",

  // Bilder / bakgrunder / ikoner
  "./leather.jpg",
  "./parchment.jpg",
  "./stars.jpg",
  "./paper_faded.jpg",
  "./icon-192.png",
  "./icon-512.png",

  // Manifest
  "./manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys
        .filter(k => k !== CACHE_NAME)
        .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Network first, fallback till cache. Cache uppdateras i bakgrunden.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req))
  );
});
