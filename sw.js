// ===== Retro Diary SW v48 =====
const CACHE_VERSION = "v50"; // ⬅️ bumpa vid varje release
const PRECACHE = `retro-diary-precache-${CACHE_VERSION}`;
const RUNTIME  = `retro-diary-runtime-${CACHE_VERSION}`;

const CORE_ASSETS = [
  "/", "index.html",
  "styles.css",
  // Lägg bara filer som faktiskt finns. Ta bort tomma/ej använda.
  "theme_light.css","theme_dark.css","theme_memory.css",
  "app.js","editor.js","crypto.js","storage.js","lock.js","memory.js","fonts_db.js","i18n.js",
  "manifest.json",
  "about.html","help.html","privacy.html",
  "paper_faded.jpg","stars.jpg",
  "icon-192.png","icon-512.png"
];

// Install: precache (tolerant) + skip waiting
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(PRECACHE);
    // Tolerant precache: cacha det som finns, skippa resten.
    const reqs = CORE_ASSETS.map(u => new Request(u, { cache: "reload" }));
    const results = await Promise.allSettled(reqs.map(r => fetch(r).then(res => {
      if (res.ok) cache.put(r, res.clone());
    })));
    // (valfritt) logga misslyckade (dev)
    // results.forEach((r,i) => { if (r.status === 'rejected') console.warn('missade', CORE_ASSETS[i]); });

    self.skipWaiting();
  })());
});

// Activate: rensa gamla cacher + navigation preload + claim
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(n => n !== PRECACHE && n !== RUNTIME)
      .map(n => caches.delete(n))
    );
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch {}
    }
    await self.clients.claim();
  })());
});

const isNavigation = (req) =>
  req.mode === "navigate" ||
  (req.method === "GET" && req.headers.get("accept")?.includes("text/html"));

// Fetch:
//  - HTML: network-first (med event.preloadResponse), fallback cache:index
//  - Övrigt: stale-while-revalidate
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  if (isNavigation(request)) {
    event.respondWith(networkFirstHTML(event));
  } else {
    event.respondWith(staleWhileRevalidate(request));
  }
});

async function networkFirstHTML(event) {
  const cache = await caches.open(PRECACHE);
  try {
    const preload = await event.preloadResponse;
    const fresh = preload || await fetch(event.request, { credentials: "same-origin" });
    // Håll shell färskt: cacha index.html (inte bara "/")
    cache.put("index.html", fresh.clone());
    return fresh;
  } catch {
    const cached = await cache.match(event.request, { ignoreSearch: true })
                || await cache.match("index.html");
    return cached || new Response("Offline", { status: 503, statusText: "Offline" });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then((res) => {
    // cacha bara ok & icke-opaque
    if (res && res.status === 200 && res.type !== "opaque") cache.put(request, res.clone());
    return res;
  }).catch(() => null);
  return cached || (await fetchPromise) || new Response(null, { status: 504 });
}

self.addEventListener("message", (e) => {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
});
