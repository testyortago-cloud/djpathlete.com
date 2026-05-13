import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { buildAuthorizationUrl, signState } from "@/lib/gsc/oauth"
import { SITE_URL } from "@/lib/constants"

export async function GET(_req: NextRequest) {
  const session = await auth()
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const clientId = process.env.GOOGLE_CLIENT_ID
  const secret = process.env.INTERNAL_CRON_TOKEN
  if (!clientId || !secret) {
    return NextResponse.json(
      { error: "Server misconfigured (GOOGLE_CLIENT_ID or INTERNAL_CRON_TOKEN missing)" },
      { status: 500 },
    )
  }

  const state = signState(
    { userId: session.user.id, ts: Date.now(), kind: "gsc" },
    secret,
  )
  const url = buildAuthorizationUrl({
    client_id: clientId,
    redirect_uri: `${SITE_URL}/api/admin/integrations/gsc/callback`,
    state,
  })
  return NextResponse.redirect(url, { status: 302 })
}
