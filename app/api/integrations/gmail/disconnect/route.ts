// app/api/integrations/gmail/disconnect/route.ts
// Clears the stored Gmail refresh token and resets the connection row to
// not_connected. Google does not require a server-side revoke call to
// invalidate the token from our end; the user can revoke from
// https://myaccount.google.com/permissions for a hard cutoff.

import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { disconnectPlatform } from "@/lib/db/platform-connections"

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  await disconnectPlatform("gmail")

  const accept = request.headers.get("accept") ?? ""
  if (accept.includes("application/json")) {
    return NextResponse.json({ success: true })
  }
  // Form POST from a <form> — redirect back to inbox.
  const url = new URL("/admin/inbox", request.url)
  url.searchParams.set("disconnected", "1")
  return NextResponse.redirect(url, { status: 303 })
}
