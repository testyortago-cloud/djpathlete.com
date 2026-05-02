import { auth } from "@/lib/auth"
import { NextResponse, type NextRequest } from "next/server"
import {
  ATTR_COOKIE_NAME,
  ATTR_COOKIE_MAX_AGE,
  generateSessionId,
} from "@/lib/marketing/cookies"
import { extractTrackingParamsFromUrl, hasAnyTrackingParam } from "@/lib/marketing/attribution"

const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"]

function redirectToLogin(req: NextRequest) {
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

  let res: NextResponse

  if (pathname.startsWith("/admin")) {
    if (!isLoggedIn) return redirectToLogin(req)
    if (userRole !== "admin") return NextResponse.redirect(new URL("/client/dashboard", req.url))
    res = NextResponse.next()
  } else if (pathname.startsWith("/client")) {
    if (!isLoggedIn) return redirectToLogin(req)
    res = NextResponse.next()
  } else {
    res = NextResponse.next()
  }

  return captureAttribution(req, res)
})

export const config = {
  matcher: [
    // Run on every page request that is NOT a static asset / API route.
    // We deliberately do NOT match /api/* (avoids re-entry into our own track endpoint)
    // or /_next/* (static files).
    "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|woff2?)$).*)",
  ],
}
