// app/api/admin/inbox/threads/route.ts
// Lists Gmail threads for the connected mailbox. Defaults to "in:inbox" so
// the admin sees actual incoming mail (leads). The client can override the
// query string via ?q=...; pagination uses Gmail's nextPageToken.
//
// We hydrate each thread list item with a metadata-only fetch of its first
// message so the UI can render From/Subject/Date without N round-trips on
// the client side.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import {
  GmailNotConnectedError,
  decodeMessage,
  getAccessTokenForConnection,
  getMessageMetadata,
  getThread,
  listThreads,
} from "@/lib/gmail/client"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const q = request.nextUrl.searchParams.get("q") ?? "in:inbox"
  const pageToken = request.nextUrl.searchParams.get("pageToken") ?? undefined
  const maxResults = Math.min(
    50,
    Math.max(5, Number(request.nextUrl.searchParams.get("maxResults") ?? 25)),
  )

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

  let list
  try {
    list = await listThreads(accessToken, { q, pageToken, maxResults })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 })
  }

  // Hydrate with the most recent message per thread (metadata only) so the
  // UI gets From/Subject/Date in one round-trip. We fetch the thread
  // (cheap-ish) and use its last message's headers — this also gives us
  // the unread label state for the indicator dot.
  const items = await Promise.all(
    (list.threads ?? []).map(async (t) => {
      try {
        const thread = await getThread(accessToken, t.id)
        const last = thread.messages?.[thread.messages.length - 1]
        if (!last) return null
        const decoded = decodeMessage(last)
        const anyUnread = (thread.messages ?? []).some((m) => (m.labelIds ?? []).includes("UNREAD"))
        return {
          id: t.id,
          snippet: t.snippet ?? thread.snippet ?? "",
          messageCount: thread.messages?.length ?? 1,
          isUnread: anyUnread,
          from: decoded.from,
          to: decoded.to,
          subject: decoded.subject,
          date: decoded.date,
          internalDate: decoded.internalDate,
        }
      } catch {
        // Fall back to bare metadata if a thread fails — better than dropping
        // the page on a single transient error.
        try {
          const meta = await getMessageMetadata(accessToken, t.id)
          const decoded = decodeMessage(meta)
          return {
            id: t.id,
            snippet: t.snippet ?? "",
            messageCount: 1,
            isUnread: decoded.isUnread,
            from: decoded.from,
            to: decoded.to,
            subject: decoded.subject,
            date: decoded.date,
            internalDate: decoded.internalDate,
          }
        } catch {
          return null
        }
      }
    }),
  )

  return NextResponse.json({
    emailAddress,
    threads: items.filter(Boolean),
    nextPageToken: list.nextPageToken ?? null,
  })
}
