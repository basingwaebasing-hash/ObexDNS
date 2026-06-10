/**
 * sw-icon-cache.js - Icon Caching Business Logic
 *
 * This file contains the single responsibility of managing the cache,
 * fetch logic, and prefetching for DuckDuckGo favicon icons.
 */

const CACHE_NAME = "obex-dns-icons-v1";
const DUCKDUCKGO_ICON_PREFIX = "https://icons.duckduckgo.com/ip3/";

const ONE_DAY = 24 * 60 * 60 * 1000;
const THREE_DAYS = 3 * 24 * 60 * 60 * 1000;
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

/**
 * Checks if a given request URL matches the DuckDuckGo icon prefix.
 * @param {string} url
 * @returns {boolean}
 */
function isIconRequest(url) {
  return url.startsWith(DUCKDUCKGO_ICON_PREFIX);
}

/**
 * Helper to write a request-response pair along with a timestamp to the cache.
 * @param {Cache} cache
 * @param {Request} request
 * @param {Response} response
 */
async function putInCache(cache, request, response) {
  const timestampRequest = new Request(request.url + "?sw-cached-at");
  const timestampResponse = new Response(Date.now().toString());

  await cache.put(request, response);
  await cache.put(timestampRequest, timestampResponse);
}

/**
 * Helper to get the age of a cached request in milliseconds.
 * @param {Cache} cache
 * @param {Request} request
 * @returns {Promise<number>} age in milliseconds
 */
async function getCacheAge(cache, request) {
  try {
    const timestampRequest = new Request(request.url + "?sw-cached-at");
    const timestampResponse = await cache.match(timestampRequest);
    if (!timestampResponse) return Infinity;

    const cachedTimeText = await timestampResponse.text();
    const cachedTime = parseInt(cachedTimeText, 10);
    if (isNaN(cachedTime)) return Infinity;

    return Date.now() - cachedTime;
  } catch (err) {
    return Infinity;
  }
}

/**
 * Handles fetching of icon requests with Timed Stale-While-Revalidate policy.
 * @param {FetchEvent} event
 * @returns {Promise<Response>}
 */
async function handleIconFetch(event) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(event.request);

  if (cachedResponse) {
    const age = await getCacheAge(cache, event.request);

    // 1. Fresh cache (< 1 day): return immediately, no network request.
    if (age < THREE_DAYS) {
      return cachedResponse;
    }

    // 2. Stale cache (1-7 days): return immediately, fetch/update in background.
    if (age < SEVEN_DAYS) {
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse.ok || networkResponse.status === 0) {
            putInCache(cache, event.request, networkResponse);
          }
        })
        .catch(() => {
          /* Ignore background update errors */
        });
      return cachedResponse;
    }
  }

  // 3. Expired or not cached: fetch from network.
  return fetch(event.request)
    .then((networkResponse) => {
      if (networkResponse.ok || networkResponse.status === 0) {
        putInCache(cache, event.request, networkResponse.clone());
      }
      return networkResponse;
    })
    .catch(() => {
      return cachedResponse || Response.error();
    });
}

/**
 * Prefetches and caches a list of domains.
 * @param {string[]} domains
 */
function handleIconPrefetch(domains = []) {
  caches.open(CACHE_NAME).then((cache) => {
    domains.forEach((domain) => {
      const url = `${DUCKDUCKGO_ICON_PREFIX}${domain.replace(/^\*\./, "")}.ico`;
      const request = new Request(url, { mode: "no-cors" });

      cache.match(request).then((res) => {
        if (!res) {
          fetch(request)
            .then((networkResponse) => {
              if (networkResponse.ok || networkResponse.status === 0) {
                putInCache(cache, request, networkResponse);
              }
            })
            .catch(() => {
              /* Ignore prefetch errors */
            });
        }
      });
    });
  });
}
