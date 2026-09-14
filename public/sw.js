// DJP Athlete Service Worker
// Plain JavaScript — NOT TypeScript

const APP_SHELL_CACHE = "djp-app-shell-v1"
const STATIC_CACHE = "djp-static-v1"
// v3: the v2 entries were written by a stale-while-revalidate strategy and are
// answers from whenever each URL was last visited. The rename is load-bearing —
// `activate` deletes every cache not in CURRENT_CACHES, which is what evicts
// them. Dropping the bump leaves that stale data sitting in every installed PWA.
const API_CACHE = "djp-api-v3"
const PAGES_CACHE = "djp-pages-v1"

const CURRENT_CACHES = [APP_SHELL_CACHE, STATIC_CACHE, API_CACHE, PAGES_CACHE]

// URLs to pre-cache during install
const APP_SHELL_URLS = [
  "/client/dashboard",
  "/client/workouts",
  "/client/progress",
  "/client/profile",
  "/manifest.json",
  "/icons/icon-192x192.png",
  "/icons/icon-512x512.png",
]

// Install event — pre-cache app shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(APP_SHELL_CACHE)
      .then((cache) => {
        // Use addAll with individual error handling so one failure
        // doesn't prevent the rest from caching
        return Promise.allSettled(
          APP_SHELL_URLS.map((url) =>
            cache.add(url).catch((err) => {
              console.warn(`[SW] Failed to pre-cache ${url}:`, err)
            }),
          ),
        )
      })
      .then(() => {
        console.log("[SW] App shell pre-cached")
        // Take over from the previous worker straight away instead of waiting
        // for every tab it controls to be closed.
        //
        // Nothing sends the SKIP_WAITING message below — the handler has never
        // had a caller — so without this a fixed worker just sits in "waiting"
        // on any phone with a parked tab, and the OLD one keeps answering. That
        // is precisely the population this fix is for: clients who leave the
        // check-in link open for days. Safe here because this worker only
        // caches; it holds no app state a mid-session handover could tear.
        return self.skipWaiting()
      }),
  )
})

// Activate event — clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => !CURRENT_CACHES.includes(name))
            .map((name) => {
              console.log(`[SW] Deleting old cache: ${name}`)
              return caches.delete(name)
            }),
        )
      })
      .then(() => {
        console.log("[SW] Activated and old caches cleaned")
        return self.clients.claim()
      }),
  )
})

// Helper: determine if a request is for a static asset
function isStaticAsset(url) {
  return (
    url.pathname.match(/\.(js|css|woff2?|ttf|otf|eot|png|jpg|jpeg|gif|svg|ico|webp|avif)$/) ||
    url.pathname.startsWith("/_next/static/")
  )
}

// Helper: determine if a request is for an API route (exclude auth endpoints)
function isApiRequest(url) {
  return url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/auth/")
}

// Helper: API answers that must never come from a cache, online or off.
// A session balance is a number the client immediately acts on, and a stale copy
// is indistinguishable on screen from a live one. Offline, refusing to answer is
// honest — the check-in itself is a POST and would fail anyway.
function isLiveOnlyApi(url) {
  return url.pathname.startsWith("/api/checkin")
}

// Helper: determine if a request is a navigation (HTML page)
function isNavigationRequest(request) {
  return (
    request.mode === "navigate" || (request.method === "GET" && request.headers.get("accept")?.includes("text/html"))
  )
}

// Fetch event — apply different caching strategies
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url)

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return

  // Skip non-GET requests
  if (event.request.method !== "GET") return

  // Strategy: Static assets — Cache-first, fallback to network
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached

        return fetch(event.request)
          .then((response) => {
            // Only cache valid responses
            if (!response || response.status !== 200) return response

            const responseToCache = response.clone()
            caches.open(STATIC_CACHE).then((cache) => {
              cache.put(event.request, responseToCache)
            })
            return response
          })
          .catch(() => {
            // Static asset unavailable offline — return nothing
            return new Response("", { status: 408, statusText: "Offline" })
          })
      }),
    )
    return
  }

  // Strategy: API responses — Network-first, cache as an OFFLINE fallback only.
  //
  // This used to be stale-while-revalidate: answer from the cache immediately,
  // refresh it in the background for next time. For data the user reads a number
  // off and then acts on, that is a bug with no visible symptom — every visit
  // showed the PREVIOUS visit's answer. A client's check-in screen said "5
  // sessions left" on a pack that held 3 (two coach check-ins had happened since
  // his last visit), and only tapping Check in — a POST, which the cache never
  // touched — revealed the real number. Never answer a live figure from a cache
  // just because it is faster.
  if (isApiRequest(url)) {
    // Balances are never answered from the cache at all, not even offline.
    if (isLiveOnlyApi(url)) return

    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const responseToCache = response.clone()
            caches.open(API_CACHE).then((cache) => {
              cache.put(event.request, responseToCache)
            })
          }
          return response
        })
        .catch(() =>
          // Network failed — last known answer, or an honest 503.
          caches.match(event.request).then(
            (cached) =>
              cached ||
              new Response(JSON.stringify({ error: "Offline" }), {
                status: 503,
                headers: { "Content-Type": "application/json" },
              }),
          ),
        ),
    )
    return
  }

  // Strategy: Navigation requests — Network-first, fallback to cache, then offline page
  if (isNavigationRequest(event.request)) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const responseToCache = response.clone()
            caches.open(PAGES_CACHE).then((cache) => {
              cache.put(event.request, responseToCache)
            })
          }
          return response
        })
        .catch(() => {
          return caches.match(event.request).then((cached) => {
            if (cached) return cached

            // Try the dashboard as a fallback for any client route
            return caches.match("/client/dashboard").then((dashboardCached) => {
              if (dashboardCached) return dashboardCached

              // Ultimate fallback: offline page
              return caches.match("/offline.html").then((offlinePage) => {
                return (
                  offlinePage ||
                  new Response("<html><body><h1>Offline</h1><p>Please check your connection.</p></body></html>", {
                    headers: { "Content-Type": "text/html" },
                  })
                )
              })
            })
          })
        }),
    )
    return
  }

  // Strategy: Everything else — Network-first with cache fallback
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200) {
          const responseToCache = response.clone()
          caches.open(STATIC_CACHE).then((cache) => {
            cache.put(event.request, responseToCache)
          })
        }
        return response
      })
      .catch(() => {
        return caches.match(event.request)
      }),
  )
})

// Message handling — allow immediate activation of new service worker
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting()
  }
})
