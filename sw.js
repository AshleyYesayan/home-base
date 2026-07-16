// Home Base service worker — always fetch fresh app code; cache only as an offline fallback.
const CACHE = "homebase-v17";
const SHELL = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  // Network-first, and never let the browser hand us a stale cached copy.
  e.respondWith(
    fetch(req, { cache: "no-store" })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((m) => m || caches.match("./index.html")))
  );
});

/* ---------- Web Push ---------- */
self.addEventListener("push", function(event){
  var d = {};
  try { d = event.data ? event.data.json() : {}; }
  catch (e) { d = { title: "Home Base", body: event.data ? event.data.text() : "" }; }
  event.waitUntil(
    self.registration.showNotification(d.title || "Home Base", {
      body: d.body || "",
      icon: "icon-192.png",
      badge: "icon-192.png",
      tag: d.tag || "homebase",
      data: { url: d.url || "./" }
    })
  );
});

self.addEventListener("notificationclick", function(event){
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || "./";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function(list){
      for (var i = 0; i < list.length; i++){
        if (list[i].url.indexOf("home-base") > -1 && "focus" in list[i]) return list[i].focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
