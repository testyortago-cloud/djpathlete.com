// app/api/admin/inbox/send/route.ts
// Sends mail on the connected Gmail mailbox. Two modes:
//   • Reply: client posts { threadId, body } — server fetches the thread to
//     derive To, "Re: …" subject, and In-Reply-To / References so Gmail keeps
//     the message in the same conversation.
//   • Compose: client posts { to, subject, body } (no threadId) — server
//     sends a brand-new message.

import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { recordAudit } from "@/lib/audit/record"
import {
  GmailNotConnectedError,
  decodeMessage,
  getAccessTokenForConnection,
  getThread,
  sendMessage,
} from "@/lib/gmail/client"

const sendSchema = z
  .object({
    threadId: z.string().min(1).optional(),
    body: z.string().min(1).max(50_000),
    to: z.string().email().optional(),
    subject: z.string().min(1).max(998).optional(),
    cc: z.string().optional(),
  })
  .refine((v) => v.threadId || (v.to && v.subject), {
    message: "Either threadId (reply) or to + subject (compose) is required",
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

  // Compose path: no threadId, caller supplied to + subject directly.
  if (!payload.threadId) {
    try {
      const sent = await sendMessage({
        accessToken,
        fromEmail: emailAddress,
        to: payload.to!,
        cc: payload.cc,
        subject: payload.subject!,
        bodyText: payload.body,
      })
      await recordAudit({
        action: "inbox.message_sent",
        category: "support",
        target: { type: "conversation", id: sent.threadId, label: payload.to },
        metadata: {
          channel: "gmail",
          mode: "compose",
          has_attachments: false,
          body_length: payload.body?.length ?? 0,
          subject_length: payload.subject?.length ?? 0,
          has_cc: Boolean(payload.cc),
        },
        request,
      })
      return NextResponse.json({ success: true, message: sent })
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 502 })
    }
  }

  // Reply path: derive To / Subject / threading headers from the thread.
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
    const sent = await sendMessage({
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
    await recordAudit({
      action: "inbox.message_sent",
      category: "support",
      target: { type: "conversation", id: payload.threadId, label: replyTo },
      metadata: {
        channel: "gmail",
        mode: "reply",
        has_attachments: false,
        body_length: payload.body?.length ?? 0,
        subject_length: subject?.length ?? 0,
        has_cc: Boolean(payload.cc),
      },
      request,
    })
    return NextResponse.json({ success: true, message: sent })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 })
  }
}
