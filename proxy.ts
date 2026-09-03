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
  PAGE_PATH_HEADER,
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
    // GRANTED pass-through: this request cleared the gate for `pathname`, so
    // it gets the AUTHORISATION headers (see their own comment in
    // registry.ts) — always from a fresh Headers object, so a client cannot
    // forge either one for the server-action re-check in
    // lib/permissions/guard.ts's canAccessAdminPath. PAGE_PATH_HEADER rides
    // along too, since a granted request obviously also renders.
    const grantedPassThrough = () => {
      const headers = new Headers(req.headers)
      headers.set(ADMIN_PATH_HEADER, pathname)
      headers.set(ADMIN_METHOD_HEADER, req.method)
      headers.set(PAGE_PATH_HEADER, pathname)
      return NextResponse.next({ request: { headers } })
    }
    // DENIED but still rendered: only the staff home-page / NO_ACCESS_PATH
    // loop-guard below uses this. It must NOT carry the authorisation
    // headers — the gate said no for `pathname`, and stamping ADMIN_PATH_HEADER
    // here would read as "the gate said yes" to canAccessAdminPath. It still
    // needs PAGE_PATH_HEADER, which is the whole reason this exists: so
    // app/(admin)/admin/layout.tsx can tell it is already rendering
    // NO_ACCESS_PATH and skip its own redirect() there (Task 7's tenant
    // resolver throws NoAccessibleBusinessError independent of which page was
    // requested, and NO_ACCESS_PATH is a page nested under that same layout —
    // without this it would redirect from NO_ACCESS_PATH to itself, forever).
    const deniedRenderWithPagePath = () => {
      const headers = new Headers(req.headers)
      headers.set(PAGE_PATH_HEADER, pathname)
      return NextResponse.next({ request: { headers } })
    }
    if (!isLoggedIn) {
      res = redirectToLogin(req)
    } else if (userRole === "staff") {
      // Default-deny: an /admin path in no registry rule is denied, so a new
      // admin surface is unreachable to staff until it is mapped deliberately.
      if (canAccessPath({ role: "staff", permissions }, pathname, req.method)) {
        res = grantedPassThrough()
      } else {
        const home = staffHomePath(permissions)
        // Never bounce someone off the page we would bounce them to.
        res =
          pathname === home || pathname === NO_ACCESS_PATH
            ? deniedRenderWithPagePath()
            : NextResponse.redirect(new URL(NO_ACCESS_PATH, req.url))
      }
    } else if (userRole !== "admin") {
      // Editors and clients sent to their own home
      const home = userRole === "editor" ? "/editor" : "/client/dashboard"
      res = NextResponse.redirect(new URL(home, req.url))
    } else {
      res = grantedPassThrough()
    }
    // PAGE_PATH_HEADER on the redirect branches above is functionally inert —
    // a redirect never reaches a render, so nothing downstream ever reads a
    // response header off a 307 — but setting it unconditionally here means
    // no branch has to remember to do it, rather than four places that could
    // each independently forget.
    res.headers.set(PAGE_PATH_HEADER, pathname)
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
