const CACHE_NAME = "vs-admin-v1";
const urlsToCache = [
  "/",
  "/index.html",
  "/manifest.json",
  "/css/notifications.css",
  "/js/admin.js",
  "/js/utils.js",
  "/images/app-icon-192.png",
  "/images/app-icon-512.png",
  "/images/app-icon-maskable.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache))
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches
      .match(event.request)
      .then((response) => response || fetch(event.request))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});
