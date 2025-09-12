const CACHE_NAME = "retro-diary-book16";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=book12",
  "./app.js?v=book12",
  "./leather.jpg",
  "./parchment.jpg",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", e=>{
  e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(ASSETS)));
});

self.addEventListener("activate", e=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k))))
  );
});

self.addEventListener("fetch", e=>{
  e.respondWith(
    fetch(e.request).then(res=>{
      const copy=res.clone();
      caches.open(CACHE_NAME).then(c=>c.put(e.request, copy));
      return res;
    }).catch(()=>caches.match(e.request))
  );
});
