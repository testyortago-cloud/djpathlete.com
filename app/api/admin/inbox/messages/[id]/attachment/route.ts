// app/api/admin/inbox/messages/[id]/attachment/route.ts
// Streams a Gmail attachment for the admin inbox viewer. attachmentId rides in
// the query string (Gmail ids run hundreds of chars — too hostile for a path
// segment). name/mime are DISPLAY HINTS from the client: both are scrubbed,
// and active content types (html/svg/xml/js) are forced to octet-stream so an
// attacker-named attachment can never execute from our origin.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import {
  GmailNotConnectedError,
  getAccessTokenForConnection,
  getAttachment,
} from "@/lib/gmail/client"

export const dynamic = "force-dynamic"

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await context.params
  const attachmentId = request.nextUrl.searchParams.get("attachmentId")
  if (!attachmentId) {
    return NextResponse.json({ error: "attachmentId required" }, { status: 400 })
  }
  const rawName = request.nextUrl.searchParams.get("name") ?? "attachment"
  const rawMime = request.nextUrl.searchParams.get("mime") ?? ""

  let accessToken: string
  try {
    ;({ accessToken } = await getAccessTokenForConnection())
  } catch (err) {
    if (err instanceof GmailNotConnectedError) {
      return NextResponse.json({ error: "not_connected" }, { status: 409 })
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }

  try {
    const buf = await getAttachment(accessToken, id, attachmentId)
    const mime =
      /^[\w.+-]+\/[\w.+-]+$/.test(rawMime) && !/html|xml|javascript|svg/i.test(rawMime)
        ? rawMime
        : "application/octet-stream"
    const filename = rawName.replace(/[\r\n"\\]/g, "_").slice(0, 150) || "attachment"
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": mime,
        "Content-Disposition": `inline; filename="${filename}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=300",
      },
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 })
  }
}
