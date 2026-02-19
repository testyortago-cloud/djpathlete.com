import { auth } from "@/lib/auth"
import { NextResponse } from "next/server"

export default auth((req) => {
  const { pathname } = req.nextUrl
  const isLoggedIn = !!req.auth
  const userRole = req.auth?.user?.role

  // Admin routes — require admin role
  if (pathname.startsWith("/admin")) {
    if (!isLoggedIn) {
      return NextResponse.redirect(new URL("/login", req.url))
    }
    if (userRole !== "admin") {
      return NextResponse.redirect(new URL("/client/dashboard", req.url))
    }
    return NextResponse.next()
  }

  // Client routes — require any auth
  if (pathname.startsWith("/client")) {
    if (!isLoggedIn) {
      return NextResponse.redirect(new URL("/login", req.url))
    }
    return NextResponse.next()
  }

  // API admin routes — require admin role
  if (pathname.startsWith("/api/admin")) {
    if (!isLoggedIn || userRole !== "admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    return NextResponse.next()
  }

  return NextResponse.next()
})

export const config = {
  matcher: ["/admin/:path*", "/client/:path*", "/api/admin/:path*"],
}
