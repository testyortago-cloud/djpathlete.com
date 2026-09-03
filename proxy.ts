import { auth } from "@/lib/auth"
import { NextResponse, type NextRequest } from "next/server"
import {
  ATTR_COOKIE_NAME,
  ATTR_COOKIE_MAX_AGE,
  generateSessionId,
} from "@/lib/marketing/cookies"
import { extractTrackingParamsFromUrl, hasAnyTrackingParam } from "@/lib/marketing/attribution"
import {
  canAccessPath,
  staffHomePath,
  NO_ACCESS_PATH,
  ADMIN_PATH_HEADER,
  ADMIN_METHOD_HEADER,
} from "@/lib/permissions/registry"

const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"]

function redirectToLogin(req: NextRequest): NextResponse {
  const url = new URL("/login", req.url)
  url.searchParams.set("callbackUrl", req.nextUrl.pathname)
  const res = NextResponse.redirect(url)
  for (const name of SESSION_COOKIES) res.cookies.delete(name)
  return res
}

/**
 * Stamp the djp_attr cookie if missing. Capture tracking params in the URL
 * and fire a non-blocking POST to /api/public/attribution/track with the
 * resolved session_id. Returns the (possibly modified) NextResponse to be
 * returned to the client — caller may set further cookies/redirects on it.
 */
function captureAttribution(req: NextRequest, res: NextResponse): NextResponse {
  const params = extractTrackingParamsFromUrl(req.nextUrl)
  if (!hasAnyTrackingParam(params)) return res

  let sessionId = req.cookies.get(ATTR_COOKIE_NAME)?.value
  if (!sessionId || !/^[A-Za-z0-9_-]+$/.test(sessionId)) {
    sessionId = generateSessionId()
    res.cookies.set({
      name: ATTR_COOKIE_NAME,
      value: sessionId,
      maxAge: ATTR_COOKIE_MAX_AGE,
      sameSite: "lax",
      path: "/",
      secure: req.nextUrl.protocol === "https:",
      httpOnly: false,
    })
  }

  // Fire-and-forget POST to track endpoint. We don't await — landing must not block.
  const trackUrl = new URL("/api/public/attribution/track", req.nextUrl)
  const referrer = req.headers.get("referer") ?? undefined
  fetch(trackUrl.toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      session_id: sessionId,
      ...params,
      referrer: referrer?.slice(0, 2000),
    }),
  }).catch((err) => {
    console.warn("[middleware:attribution]", (err as Error).message)
  })

  return res
}

export default auth((req) => {
  const { pathname } = req.nextUrl
  const isLoggedIn = !!req.auth
  const userRole = req.auth?.user?.role
  const permissions = req.auth?.user?.permissions ?? {}

  // /api/admin/* — the path-aware gate for the 298 admin API routes.
  //
  // ONLY `staff` sessions are evaluated here. Anonymous, admin, client and
  // editor requests fall through untouched, which keeps cron and webhook
  // traffic to /api/admin/internal/* — authenticated by shared secret, with no
  // session — working exactly as before, and means this branch introduces zero
  // behavioural change for every actor that existed before staff did.
  //
  // Returns before captureAttribution so we never re-enter our own track
  // endpoint from an API request.
  if (pathname.startsWith("/api/")) {
    if (userRole === "staff" && !canAccessPath({ role: "staff", permissions }, pathname, req.method)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    // Stamp the resolved path so route handlers can re-derive the permission
    // themselves rather than trusting that this ran. Always overwritten, so a
    // client cannot forge it; absent (middleware skipped) means the route
    // guard denies staff, which is the safe direction.
    const headers = new Headers(req.headers)
    headers.set(ADMIN_PATH_HEADER, pathname)
    headers.set(ADMIN_METHOD_HEADER, req.method)
    return NextResponse.next({ request: { headers } })
  }

  // Resolve the auth-side response first; ALWAYS run captureAttribution on it
  // before returning, so a user clicking an ad like
  //   /client/dashboard?gclid=...&utm_source=google
  // still gets their cookie + attribution row stamped on the redirect to /login.
  let res: NextResponse

  if (pathname.startsWith("/admin")) {
    // Stamped on every request this middleware lets through to an /admin
    // page (not just /api/admin/*, as above) so app/(admin)/admin/layout.tsx
    // can tell, without a redirect of its own, whether it is already
    // rendering NO_ACCESS_PATH. Task 7's tenant resolver can throw
    // NoAccessibleBusinessError for a signed-in admin/staff session with no
    // reachable business, independent of which page was requested — and
    // that page IS reachable at /admin/no-access itself, nested under this
    // same layout. Without this header the layout would redirect() to
    // NO_ACCESS_PATH from NO_ACCESS_PATH, forever.
    const passThrough = () => {
      const headers = new Headers(req.headers)
      headers.set(ADMIN_PATH_HEADER, pathname)
      return NextResponse.next({ request: { headers } })
    }
    if (!isLoggedIn) {
      res = redirectToLogin(req)
    } else if (userRole === "staff") {
      // Default-deny: an /admin path in no registry rule is denied, so a new
      // admin surface is unreachable to staff until it is mapped deliberately.
      if (canAccessPath({ role: "staff", permissions }, pathname, req.method)) {
        res = passThrough()
      } else {
        const home = staffHomePath(permissions)
        // Never bounce someone off the page we would bounce them to.
        res =
          pathname === home || pathname === NO_ACCESS_PATH
            ? passThrough()
            : NextResponse.redirect(new URL(NO_ACCESS_PATH, req.url))
      }
    } else if (userRole !== "admin") {
      // Editors and clients sent to their own home
      const home = userRole === "editor" ? "/editor" : "/client/dashboard"
      res = NextResponse.redirect(new URL(home, req.url))
    } else {
      res = passThrough()
    }
  } else if (pathname.startsWith("/editor")) {
    if (!isLoggedIn) {
      res = redirectToLogin(req)
    } else if (userRole !== "editor" && userRole !== "admin") {
      res = NextResponse.redirect(new URL("/client/dashboard", req.url))
    } else {
      res = NextResponse.next()
    }
  } else if (pathname.startsWith("/client")) {
    if (!isLoggedIn) {
      res = redirectToLogin(req)
    } else if (userRole === "editor") {
      res = NextResponse.redirect(new URL("/editor", req.url))
    } else {
      res = NextResponse.next()
    }
  } else {
    res = NextResponse.next()
  }

  return captureAttribution(req, res)
})

export const config = {
  matcher: [
    // Run on every page request that is NOT a static asset / API route.
    // We deliberately do NOT match /api/* in general (avoids re-entry into our
    // own track endpoint) or /_next/* (static files).
    "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|woff2?)$).*)",
    // ...with one exception: the admin API, where the permission gate lives.
    // The handler returns before captureAttribution for any /api/ path, so the
    // re-entry concern above does not apply here.
    "/api/admin/:path*",
  ],
}
