import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { buildAuthorizationUrl, signState } from "@/lib/gsc/oauth"

export async function GET(req: NextRequest) {
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
  // redirect_uri derived from the request's origin so it matches localhost in
  // dev and production in prod — same OAuth client can serve both as long as
  // both origins are whitelisted in Google Cloud Console.
  const redirectUri = `${req.nextUrl.origin}/api/admin/integrations/gsc/callback`
  console.log(
    `[gsc-authorize] redirect_uri=${JSON.stringify(redirectUri)} client_id_suffix=…${clientId.slice(-8)}`,
  )
  const url = buildAuthorizationUrl({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
  })
  return NextResponse.redirect(url, { status: 302 })
}
