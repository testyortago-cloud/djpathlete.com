// app/api/admin/platform-connections/facebook/disconnect/route.ts
// Disconnects Facebook (and the paired Instagram row, which shares the Page
// access token). Best-effort revokes the Page access grant with Meta so the
// next reconnect forces a fresh consent screen — useful when the admin
// picked the wrong Page or needs to re-grant scopes after App Review.

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { disconnectPlatform, getPlatformConnection } from "@/lib/db/platform-connections"

const GRAPH_VERSION = "v22.0"
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`

function siteUrl() {
  return (process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "")
}

function redirectHome(param: string) {
  const url = new URL(`${siteUrl()}/admin/platform-connections`)
  url.searchParams.set(param, "facebook")
  return NextResponse.redirect(url.toString(), { status: 303 })
}

export async function POST() {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 })
  }

  try {
    const conn = await getPlatformConnection("facebook")
    const token =
      typeof conn?.credentials?.access_token === "string" ? conn.credentials.access_token : null
    const pageId = typeof conn?.credentials?.page_id === "string" ? conn.credentials.page_id : null

    if (token && pageId) {
      await fetch(
        `${GRAPH_BASE}/${pageId}/permissions?access_token=${encodeURIComponent(token)}`,
        { method: "DELETE" },
      ).catch((err) => {
        console.warn("[facebook/disconnect] Meta revoke failed (non-fatal)", err)
      })
    }

    await disconnectPlatform("facebook")
    await disconnectPlatform("instagram")
  } catch (err) {
    console.error("[facebook/disconnect] failed", err)
    return redirectHome("error")
  }

  return redirectHome("disconnected")
}
