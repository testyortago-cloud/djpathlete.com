// app/api/admin/platform-connections/linkedin/disconnect/route.ts
// Disconnects LinkedIn. LinkedIn does not offer a programmatic token revoke
// endpoint for 3-legged OAuth — the admin revokes access from
// linkedin.com/psettings/permitted-services. So this is a DB-only disconnect;
// reconnecting re-prompts for consent only if the admin revoked manually.

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { disconnectPlatform } from "@/lib/db/platform-connections"

function siteUrl() {
  return (process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "")
}

function redirectHome(param: string) {
  const url = new URL(`${siteUrl()}/admin/platform-connections`)
  url.searchParams.set(param, "linkedin")
  return NextResponse.redirect(url.toString(), { status: 303 })
}

export async function POST() {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 })
  }

  try {
    await disconnectPlatform("linkedin")
  } catch (err) {
    console.error("[linkedin/disconnect] failed", err)
    return redirectHome("error")
  }

  return redirectHome("disconnected")
}
