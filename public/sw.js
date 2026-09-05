const CACHE_NAME = "quickmark-v5";

const LOCAL_ASSETS = [
  "./",
  "./index.html",
];

const CDN_ASSETS = new Set([
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.6.82/pdf.min.mjs",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.6.82/pdf.worker.min.mjs",
  "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm",
]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(LOCAL_ASSETS);

      await Promise.all(
        [...CDN_ASSETS].map(async (url) => {
          try {
            const response = await fetch(url, { cache: "no-store" });
            if (response.ok || response.type === "opaque") {
              await cache.put(url, response.clone());
            }
          } catch {
            // Ignore CDN warm-up failures; runtime fetch will still work.
          }
        })
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
          return Promise.resolve();
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isCdnAsset = CDN_ASSETS.has(url.href);

  if (!isSameOrigin && !isCdnAsset) {
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then((response) => {
      if (response.ok || response.type === "opaque") {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    return cached;
  }

  const network = await networkPromise;
  if (network) {
    return network;
  }

  if (request.mode === "navigate") {
    const fallback = await cache.match("./index.html");
    if (fallback) {
      return fallback;
    }
  }

  return new Response("Offline", {
    status: 503,
    statusText: "Offline",
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
