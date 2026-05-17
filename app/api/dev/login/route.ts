// app/api/dev/login/route.ts
// Dev-only auto-login. Mints a NextAuth JWT cookie for the user identified by
// DEV_AUTH_BYPASS_EMAIL and redirects to ?callbackUrl=... (or /admin/dashboard).
// Replaces the email/password dance for local Playwright runs and curl tests.
//
// Triple-gated — returns 404 unless ALL of:
//   - NODE_ENV !== "production"
//   - process.env.VERCEL is unset (Vercel sets VERCEL=1 in every deployment)
//   - DEV_AUTH_BYPASS_ENABLED === "true" (explicit opt-in in .env.local)
//
// Also requires DEV_AUTH_BYPASS_EMAIL to point at an existing admin user.
// Non-admin or missing users get 403/404. This route is intentionally NOT
// imported anywhere — the file's existence alone doesn't activate it.

import { NextRequest, NextResponse } from "next/server"
import { encode } from "next-auth/jwt"
import { createServiceRoleClient } from "@/lib/supabase"

function isDevBypassAllowed(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    !process.env.VERCEL &&
    process.env.DEV_AUTH_BYPASS_ENABLED === "true"
  )
}

export async function GET(request: NextRequest) {
  if (!isDevBypassAllowed()) {
    return NextResponse.json({ error: "Not Found" }, { status: 404 })
  }

  const email = process.env.DEV_AUTH_BYPASS_EMAIL
  const secret = process.env.NEXTAUTH_SECRET
  if (!email || !secret) {
    return NextResponse.json(
      { error: "DEV_AUTH_BYPASS_EMAIL or NEXTAUTH_SECRET missing from .env.local" },
      { status: 500 },
    )
  }

  const supabase = createServiceRoleClient()
  const { data: user, error } = await supabase
    .from("users")
    .select("id, email, first_name, last_name, role")
    .eq("email", email)
    .single()

  if (error || !user) {
    return NextResponse.json({ error: `User not found: ${email}` }, { status: 404 })
  }
  if (user.role !== "admin") {
    return NextResponse.json({ error: `User is not admin: ${email}` }, { status: 403 })
  }

  const token = await encode({
    secret,
    salt: "authjs.session-token",
    token: {
      id: user.id,
      sub: user.id,
      email: user.email,
      name: `${user.first_name} ${user.last_name}`,
      role: user.role,
    },
    maxAge: 24 * 60 * 60,
  })

  const url = new URL(request.url)
  const callbackUrl = url.searchParams.get("callbackUrl") ?? "/admin/dashboard"
  const response = NextResponse.redirect(new URL(callbackUrl, url.origin))
  response.cookies.set("authjs.session-token", token, {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    path: "/",
    maxAge: 24 * 60 * 60,
  })

  console.warn(`[dev-login] BYPASS USED — signed in as ${email}`)
  return response
}
