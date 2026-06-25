// Divvy service worker — minimal app-shell cache.
const CACHE = "divvy-v2";
const SHELL = ["/", "/divvy.css", "/mascot.js", "/app.js", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Never cache API calls — always go to the network.
  if (url.pathname.startsWith("/api/")) return;

  // Navigations and GETs: network-first, fall back to cache.
  event.respondWith(
    fetch(req)
      .then((res) => {
        // Cache same-origin successful responses for offline use.
        if (res && res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) => {
          if (hit) return hit;
          // For navigations, fall back to the app shell.
          if (req.mode === "navigate") return caches.match("/");
          return Response.error();
        })
      )
  );
});
