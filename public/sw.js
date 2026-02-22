// DJP Athlete Service Worker
// Plain JavaScript — NOT TypeScript

const APP_SHELL_CACHE = "djp-app-shell-v1"
const STATIC_CACHE = "djp-static-v1"
const API_CACHE = "djp-api-v2"
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
            })
          )
        )
      })
      .then(() => {
        console.log("[SW] App shell pre-cached")
      })
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
            })
        )
      })
      .then(() => {
        console.log("[SW] Activated and old caches cleaned")
        return self.clients.claim()
      })
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

// Helper: determine if a request is a navigation (HTML page)
function isNavigationRequest(request) {
  return (
    request.mode === "navigate" ||
    (request.method === "GET" && request.headers.get("accept")?.includes("text/html"))
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
      })
    )
    return
  }

  // Strategy: API responses — Stale-while-revalidate
  if (isApiRequest(url)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const fetchPromise = fetch(event.request)
          .then((response) => {
            if (response && response.status === 200) {
              const responseToCache = response.clone()
              caches.open(API_CACHE).then((cache) => {
                cache.put(event.request, responseToCache)
              })
            }
            return response
          })
          .catch(() => {
            // Network failed — cached version was already returned if available
            return cached || new Response(JSON.stringify({ error: "Offline" }), {
              status: 503,
              headers: { "Content-Type": "application/json" },
            })
          })

        // Return cached immediately if available, otherwise wait for network
        return cached || fetchPromise
      })
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
                  new Response(
                    "<html><body><h1>Offline</h1><p>Please check your connection.</p></body></html>",
                    { headers: { "Content-Type": "text/html" } }
                  )
                )
              })
            })
          })
        })
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
      })
  )
})

// Message handling — allow immediate activation of new service worker
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting()
  }
})
