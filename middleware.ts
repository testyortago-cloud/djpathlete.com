import { auth } from "@/lib/auth"
import { NextResponse } from "next/server"

/** Cookie names used by NextAuth v5 (authjs) — dev (HTTP) and prod (HTTPS). */
const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"]

/**
 * Redirect to /login and delete any stale session cookie so the browser
 * doesn't keep sending an expired/corrupt JWT on every subsequent request.
 */
function redirectToLogin(req: Parameters<Parameters<typeof auth>[0]>[0]) {
  const url = new URL("/login", req.url)
  // Preserve the original URL so login can redirect back after sign-in
  url.searchParams.set("callbackUrl", req.nextUrl.pathname)
  const res = NextResponse.redirect(url)
  // Clear stale cookies to prevent redirect loops
  for (const name of SESSION_COOKIES) {
    res.cookies.delete(name)
  }
  return res
}

export default auth((req) => {
  const { pathname } = req.nextUrl
  const isLoggedIn = !!req.auth
  const userRole = req.auth?.user?.role

  // Admin routes — require admin role
  if (pathname.startsWith("/admin")) {
    if (!isLoggedIn) {
      return redirectToLogin(req)
    }
    if (userRole !== "admin") {
      return NextResponse.redirect(new URL("/client/dashboard", req.url))
    }
    return NextResponse.next()
  }

  // Client routes — require any auth
  if (pathname.startsWith("/client")) {
    if (!isLoggedIn) {
      return redirectToLogin(req)
    }
    return NextResponse.next()
  }

  return NextResponse.next()
})

export const config = {
  matcher: ["/admin/:path*", "/client/:path*"],
}
