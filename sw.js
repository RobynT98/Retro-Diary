const CACHE_NAME = "retro-diary-v31"; // bumpa vid ändring
const CORE_ASSETS = [
  "/", "/index.html",
  "/styles.css",
  "/base.css","/layout.css","/toolbar.css","/editor.css","/lock.css","/gallery.css",
  "/theme_light.css","/theme_dark.css","/theme_memory.css",
  "/fonts_db.js","/crypto.js","/storage.js","/lock.js","/editor.js","/memory.js","/app.js",
  "/manifest.json","/sw.js",
  "/leather.jpg","/parchment.jpg",
  "/stars.jpg","/paper_faded.jpg",
  "/icon-192.png","/icon-512.png"
];

self.addEventListener("install", e=>{
  e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(CORE_ASSETS)));
  self.skipWaiting();
});
self.addEventListener("activate", e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", e=>{
  const url=new URL(e.request.url);
  if(url.origin!==location.origin) return; // hoppa över tredjepart
  e.respondWith(
    fetch(e.request).then(res=>{
      if(e.request.method==="GET"){
        const copy=res.clone(); caches.open(CACHE_NAME).then(c=>c.put(e.request, copy));
      }
      return res;
    }).catch(()=>caches.match(e.request))
  );
});
