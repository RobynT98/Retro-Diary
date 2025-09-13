const CACHE_NAME = "retro-diary-v37"; // bumpa version vid varje ändring
const CORE_ASSETS = [
  "./", 
  "index.html",
  "about.html",
  "help.html",
  "privacy.html",
  "styles.css",
  "theme_memory.css",
  "memory.js",
  "app.js",
  "crypto.js",
  "lock.js",
  "storage.js",
  "editor.js",
  "fonts_db.js",
  "manifest.json",
  "leather.jpg",
  "parchment.jpg",
  "paper_faded.jpg",
  "stars.jpg"
];

// Install – lägg allt i cache direkt
self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting(); // ta över direkt
});

// Activate – rensa gamla caches
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim(); // ta kontroll över alla sidor direkt
});

// Fetch – cache-first, nät som fallback
self.addEventListener("fetch", e => {
  e.respondWith(
    caches.match(e.request).then(cachedRes => {
      if (cachedRes) {
        // uppdatera i bakgrunden
        fetch(e.request).then(freshRes => {
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, freshRes.clone()));
        }).catch(() => {}); // ignorerar nätfel
        return cachedRes;
      }
      // inte i cache → hämta från nätet
      return fetch(e.request).catch(() => caches.match("index.html"));
    })
  );
});
