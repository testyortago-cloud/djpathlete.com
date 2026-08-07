// app/api/admin/inbox/threads/[id]/route.ts
// Fetches a single Gmail thread with all messages decoded (text + html
// bodies, headers). Also clears the UNREAD label so opening a thread in
// the admin inbox marks it read in the underlying Gmail mailbox — same
// behavior as opening it in mail.google.com.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { canAccessAdminPath } from "@/lib/permissions/guard"
import {
  GmailNotConnectedError,
  decodeThread,
  getAccessTokenForConnection,
  getThread,
  modifyThreadLabels,
} from "@/lib/gmail/client"

export const dynamic = "force-dynamic"

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id || !(await canAccessAdminPath(session.user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await context.params

  let accessToken: string
  let emailAddress: string | null
  try {
    const ctx = await getAccessTokenForConnection()
    accessToken = ctx.accessToken
    emailAddress = ctx.emailAddress
  } catch (err) {
    if (err instanceof GmailNotConnectedError) {
      return NextResponse.json({ error: "not_connected" }, { status: 409 })
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }

  try {
    const thread = await getThread(accessToken, id)
    const decoded = decodeThread(thread)
    // Mark read — fire-and-forget; we don't fail the response if it errors.
    modifyThreadLabels(accessToken, id, { removeLabelIds: ["UNREAD"] }).catch(() => {})
    return NextResponse.json({ emailAddress, thread: decoded })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 })
  }
}
