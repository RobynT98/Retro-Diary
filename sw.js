/* sw.js — Retro Diary (lite) */
const CACHE = 'rd-lite-v2';
const CORE = [
  '/',                 // om du serverar index på root
  '/index.html',
  '/styles.css',
  '/app.js?v=lite1',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

// Vilka rutter ska vara network-first (koden)
function isNetworkFirst(req){
  const p = new URL(req.url).pathname;
  return p.endsWith('/app.js') || p.includes('app.js?v=') || p.endsWith('/styles.css');
}

self.addEventListener('install', (e)=>{
  e.waitUntil((async()=>{
    const cache = await caches.open(CACHE);
    // cache: reload = hoppa över mellanlager
    await cache.addAll(CORE.map(u=>new Request(u, { cache:'reload' })));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e)=>{
  e.waitUntil((async()=>{
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k!==CACHE) && caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e)=>{
  const req = e.request;
  if(req.method!=='GET') return;

  // Network-first för koden
  if(isNetworkFirst(req)){
    e.respondWith((async()=>{
      try{
        const fresh = await fetch(req, { cache:'no-store' });
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      }catch{
        const cache = await caches.open(CACHE);
        return (await cache.match(req)) || (await cache.match(stripQuery(req))) ||
               new Response('Offline (ingen cache för koden).', {status:503});
      }
    })());
    return;
  }

  // Cache-first för allt annat
  e.respondWith((async()=>{
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, {ignoreSearch:false}) || await cache.match(stripQuery(req));
    if(hit) return hit;
    try{
      const fresh = await fetch(req);
      if(fresh.ok && (fresh.type==='basic' || fresh.type==='cors')){
        cache.put(req, fresh.clone());
      }
      return fresh;
    }catch{
      if(req.destination==='document'){
        const fallback = await cache.match('/index.html');
        if(fallback) return fallback;
      }
      return new Response('Offline.', {status:503});
    }
  })());
});

function stripQuery(req){
  const u = new URL(req.url); u.search = '';
  return new Request(u.toString(), {
    headers:req.headers, method:req.method, mode:req.mode,
    credentials:req.credentials, redirect:req.redirect,
    referrer:req.referrer, referrerPolicy:req.referrerPolicy
  });
}
