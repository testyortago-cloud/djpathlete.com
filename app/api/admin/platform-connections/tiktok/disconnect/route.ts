// app/api/admin/platform-connections/tiktok/disconnect/route.ts
// Disconnects TikTok. Best-effort revokes the access token with TikTok so a
// subsequent Connect forces a fresh consent screen.

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { disconnectPlatform, getPlatformConnection } from "@/lib/db/platform-connections"

const REVOKE_URL = "https://open.tiktokapis.com/v2/oauth/revoke/"

function siteUrl() {
  return (process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "")
}

function redirectHome(param: string) {
  const url = new URL(`${siteUrl()}/admin/platform-connections`)
  url.searchParams.set(param, "tiktok")
  return NextResponse.redirect(url.toString(), { status: 303 })
}

export async function POST() {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 })
  }

  try {
    const conn = await getPlatformConnection("tiktok")
    const token =
      typeof conn?.credentials?.access_token === "string" ? conn.credentials.access_token : null
    const clientKey =
      typeof conn?.credentials?.client_key === "string" ? conn.credentials.client_key : null
    const clientSecret =
      typeof conn?.credentials?.client_secret === "string"
        ? conn.credentials.client_secret
        : null

    if (token && clientKey && clientSecret) {
      await fetch(REVOKE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_key: clientKey,
          client_secret: clientSecret,
          token,
        }).toString(),
      }).catch((err) => {
        console.warn("[tiktok/disconnect] TikTok revoke failed (non-fatal)", err)
      })
    }

    await disconnectPlatform("tiktok")
  } catch (err) {
    console.error("[tiktok/disconnect] failed", err)
    return redirectHome("error")
  }

  return redirectHome("disconnected")
}
