/**
 * sw.js - Service Worker Entry & Event Router
 *
 * This file orchestrates the Service Worker lifecycle and routes events
 * to appropriate domain-specific sub-services (like sw-icon-cache.js).
 */

// Import domain-specific caching services
importScripts("/sw/sw-icon-cache.js");

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Router for fetch requests
self.addEventListener("fetch", (event) => {
  const url = event.request.url;

  // Intercept DuckDuckGo icon requests
  if (typeof isIconRequest === "function" && isIconRequest(url)) {
    event.respondWith(handleIconFetch(event));
  }
});

// Router for cross-thread messages
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "PREFETCH_ICONS") {
    if (typeof handleIconPrefetch === "function") {
      handleIconPrefetch(event.data.domains);
    }
  }
});
