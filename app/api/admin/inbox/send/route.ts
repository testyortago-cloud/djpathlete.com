// app/api/admin/inbox/send/route.ts
// Sends a reply on the connected Gmail mailbox. The client posts threadId +
// the body text; the server fetches the thread on the fly to derive the
// reply target (To header), Subject ("Re: ..."), and threading headers
// (In-Reply-To / References) so Gmail keeps the message in the same
// conversation.

import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import {
  GmailNotConnectedError,
  decodeMessage,
  getAccessTokenForConnection,
  getThread,
  sendReply,
} from "@/lib/gmail/client"

const sendSchema = z.object({
  threadId: z.string().min(1),
  body: z.string().min(1).max(50_000),
  // Optional override — defaults to the original sender of the last message.
  to: z.string().email().optional(),
  cc: z.string().optional(),
})

function ensureReplyPrefix(subject: string): string {
  return /^re:\s/i.test(subject) ? subject : `Re: ${subject}`
}

function extractAddress(headerValue: string): string {
  // Handles "Name <email@host>" and bare emails.
  const m = headerValue.match(/<([^>]+)>/)
  return (m?.[1] ?? headerValue).trim()
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  let payload
  try {
    payload = sendSchema.parse(await request.json())
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }

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

  if (!emailAddress) {
    return NextResponse.json({ error: "Connected mailbox has no email address" }, { status: 500 })
  }

  let lastMessage
  try {
    const thread = await getThread(accessToken, payload.threadId)
    const messages = thread.messages ?? []
    if (messages.length === 0) {
      return NextResponse.json({ error: "Thread has no messages" }, { status: 404 })
    }
    lastMessage = decodeMessage(messages[messages.length - 1]!)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 })
  }

  // Reply target: the original sender. If we sent the last message ourselves,
  // reply to whoever it was addressed to. Always derive an actual address (no
  // display name) to keep the To header clean.
  const fromAddress = extractAddress(lastMessage.from)
  const meIsSender = fromAddress.toLowerCase() === emailAddress.toLowerCase()
  const replyTo =
    payload.to ?? (meIsSender ? extractAddress(lastMessage.to) : fromAddress)

  const subject = ensureReplyPrefix(lastMessage.subject)
  const inReplyTo = lastMessage.messageId
  const references = lastMessage.references
    ? lastMessage.messageId
      ? `${lastMessage.references} ${lastMessage.messageId}`
      : lastMessage.references
    : lastMessage.messageId

  try {
    const sent = await sendReply({
      accessToken,
      fromEmail: emailAddress,
      to: replyTo,
      cc: payload.cc,
      subject,
      bodyText: payload.body,
      threadId: payload.threadId,
      inReplyTo,
      references,
    })
    return NextResponse.json({ success: true, message: sent })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 })
  }
}
