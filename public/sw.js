// Divvy service worker — minimal app-shell cache.
const CACHE = "divvy-v39";
const SHELL = [
  "/", "/divvy.css", "/manifest.webmanifest", "/icon.svg",
  // Core runtime scripts.
  "/faces.js", "/mascot.js", "/auth.js", "/app.js", "/recap.js",
  // All screens — keep these in sync with index.html so a stale screen is never
  // served against a freshly-cached app.js.
  "/screens/home.js", "/screens/welcome.js", "/screens/groups.js", "/screens/group.js",
  "/screens/new.js", "/screens/settle.js", "/screens/collect.js", "/screens/activity.js",
  "/screens/friends.js", "/screens/friend.js", "/screens/recurring.js",
  "/screens/you.js", "/screens/customize.js", "/screens/chat.js", "/screens/receipt.js",
];

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

// ---- Web Push -------------------------------------------------------------
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { data = {}; }
  const title = data.title || "Divvy";
  const options = {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: data.tag || undefined,
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      // Focus an existing tab if one is open; otherwise open a new one.
      for (const client of list) {
        if ("focus" in client) { client.navigate(url); return client.focus(); }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
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
