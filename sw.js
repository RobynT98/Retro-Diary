const CACHE_NAME = "retro-diary-v34"; // <-- bumpad version
const CORE_ASSETS = [
  "/", 
  "index.html",
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

// Install
self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS))
  );
});

// Activate – rensa gammalt
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
});

// Fetch – nät först, fallback cache
self.addEventListener("fetch", e => {
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
