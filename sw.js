const CACHE_NAME = "retro-diary-v1";
const ASSETS = [
  "index.html",
  "styles.css?v=1",
  "app.js?v=1",
  "manifest.json?v=1",
  "icon-192.png",
  "icon-512.png"
];

self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(ASSETS))
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))
    ).then(()=>self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  if(e.request.method!=="GET") return;
  e.respondWith(
    fetch(e.request).then(r=>{
      const copy = r.clone();
      caches.open(CACHE_NAME).then(c=>c.put(e.request, copy));
      return r;
    }).catch(()=>caches.match(e.request))
  );
});
