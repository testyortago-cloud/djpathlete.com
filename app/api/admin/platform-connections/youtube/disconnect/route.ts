// app/api/admin/platform-connections/youtube/disconnect/route.ts
// Disconnects YouTube (and the paired YouTube Shorts row, which shares credentials).
// Best-effort revokes the refresh token with Google so the next reconnect forces
// a fresh consent screen — that's what makes the Brand Account / channel picker
// re-appear, which is the usual reason admins hit Disconnect.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { disconnectPlatform, getPlatformConnection } from "@/lib/db/platform-connections"
import { recordAudit } from "@/lib/audit/record"

const REVOKE_URL = "https://oauth2.googleapis.com/revoke"

function siteUrl() {
  return (process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "")
}

function redirectHome(param: string) {
  const url = new URL(`${siteUrl()}/admin/platform-connections`)
  url.searchParams.set(param, "youtube")
  return NextResponse.redirect(url.toString(), { status: 303 })
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 })
  }

  try {
    const conn = await getPlatformConnection("youtube")
    const refreshToken =
      typeof conn?.credentials?.refresh_token === "string" ? conn.credentials.refresh_token : null

    if (refreshToken) {
      await fetch(`${REVOKE_URL}?token=${encodeURIComponent(refreshToken)}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }).catch((err) => {
        console.warn("[youtube/disconnect] Google revoke failed (non-fatal)", err)
      })
    }

    await disconnectPlatform("youtube")
    await recordAudit({
      action: "integration.disconnected",
      category: "admin_write",
      target: { type: "integration", id: "youtube", label: "youtube" },
      request,
    })
    await disconnectPlatform("youtube_shorts")
    await recordAudit({
      action: "integration.disconnected",
      category: "admin_write",
      target: { type: "integration", id: "youtube_shorts", label: "youtube_shorts" },
      request,
    })
  } catch (err) {
    console.error("[youtube/disconnect] failed", err)
    return redirectHome("error")
  }

  return redirectHome("disconnected")
}
