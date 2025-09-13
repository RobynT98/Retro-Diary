// ===== Retro Diary SW v36 =====
const CACHE_VERSION = "v42";                 // ⬅️ bumpa denna varje gång
const PRECACHE = `retro-diary-precache-${CACHE_VERSION}`;
const RUNTIME  = `retro-diary-runtime-${CACHE_VERSION}`;

const CORE_ASSETS = [
  "/", "index.html",
  "styles.css",
  "base.css","layout.css","toolbar.css","editor.css","lock.css","gallery.css",
  "theme_light.css","theme_dark.css","theme_memory.css",
  "app.js","editor.js","crypto.js","storage.js","lock.js","memory.js","fonts_db.js","i18n.js",
  "manifest.json",
  "about.html","help.html","privacy.html",
  "leather.jpg","parchment.jpg","paper_faded.jpg","stars.jpg",
  "icon-192.png","icon-512.png"
];

// Install: precache + skip waiting
self.addEventListener("install", (e) => {
  e.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(PRECACHE);
        await cache.addAll(CORE_ASSETS);
      } finally {
        self.skipWaiting(); // ta över direkt efter aktivering
      }
    })()
  );
});

// Activate: rensa gamla cacher + claim
self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n !== PRECACHE && n !== RUNTIME)
          .map((n) => caches.delete(n))
      );
      // Navigation preload (snabbare "first hit" om stöds)
      if (self.registration.navigationPreload) {
        try { await self.registration.navigationPreload.enable(); } catch {}
      }
      await self.clients.claim();
    })()
  );
});

// Hjälpare: avgör om begäran är HTML-navigering (index shell)
const isNavigation = (req) =>
  req.mode === "navigate" ||
  (req.method === "GET" && req.headers.get("accept")?.includes("text/html"));

// Fetch-strategier:
//  - HTML: network-first med fallback till cache (shell)
//  - Övrigt statiskt: stale-while-revalidate
self.addEventListener("fetch", (e) => {
  const { request } = e;

  // Bara GET hanteras
  if (request.method !== "GET") return;

  if (isNavigation(request)) {
    e.respondWith(networkFirstHTML(request));
  } else {
    e.respondWith(staleWhileRevalidate(request));
  }
});

async function networkFirstHTML(request) {
  const cache = await caches.open(PRECACHE);
  try {
    const preload = await ePreload();          // hämta ev. preloaded svar
    const fresh = preload || (await fetch(request, { credentials: "same-origin" }));
    cache.put("/", fresh.clone());             // håll index uppdaterad
    return fresh;
  } catch {
    const cached = await cache.match(request) || (await cache.match("/"));
    return cached || new Response("Offline", { status: 503, statusText: "Offline" });
  }
  // navigation preload helper
  async function ePreload() {
    try {
      const evt = /** @type {FetchEvent} */ (event);
      return await evt.preloadResponse;
    } catch { return null; }
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then((res) => {
    // lägg bara cachebara svar
    if (res && res.status === 200 && res.type !== "opaque") cache.put(request, res.clone());
    return res;
  }).catch(() => null);
  return cached || (await fetchPromise) || new Response(null, { status: 504 });
}

// (valfritt) Ta emot "skipWaiting" från appen
self.addEventListener("message", (e) => {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
});
