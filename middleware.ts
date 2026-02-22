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
    // Pass pathname to layout so it can gate on questionnaire completion
    const response = NextResponse.next()
    response.headers.set("x-next-pathname", pathname)
    return response
  }

  return NextResponse.next()
})

export const config = {
  matcher: ["/admin/:path*", "/client/:path*"],
}
