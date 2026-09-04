import { Resend } from "resend"
import type { NotifyGroup } from "./notify-select"

const _resend = new Resend(process.env.RESEND_API_KEY)
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "DJP Athlete <noreply@send.darrenjpaul.com>"

function baseUrl() {
  return process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export function newMessageSubject(group: NotifyGroup, senderName: string): string {
  const count = group.message_ids.length
  if (count === 1) return `New message from ${senderName}`
  return `${count} new messages from ${senderName}`
}

export function newMessageHtml(input: {
  group: NotifyGroup
  senderName: string
  recipientName: string
  link: string
}): string {
  const items = input.group.previews
    .filter((p) => p.trim().length > 0)
    .map((p) => `<li style="margin:0 0 8px 0;color:#333;">${escapeHtml(p)}</li>`)
    .join("")

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" /><meta name="color-scheme" content="light" /></head>
<body style="margin:0;padding:24px;background:#f6f7f8;font-family:'Lexend Deca',Helvetica,Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px;">
    <p style="margin:0 0 12px 0;font-size:15px;color:#333;">Hi ${escapeHtml(input.recipientName)},</p>
    <p style="margin:0 0 16px 0;font-size:15px;color:#333;">
      ${escapeHtml(input.senderName)} sent you
      ${input.group.message_ids.length === 1 ? "a message" : `${input.group.message_ids.length} messages`}.
    </p>
    ${items ? `<ul style="margin:0 0 20px 0;padding-left:18px;">${items}</ul>` : ""}
    <a href="${input.link}"
       style="display:inline-block;background:#1d3a45;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:14px;">
      Open the conversation
    </a>
    <p style="margin:20px 0 0 0;font-size:12px;color:#888;">
      You are getting this because the message was still unread a few minutes after it was sent.
      Turn these off in your notification settings.
    </p>
  </div>
</body></html>`
}

/**
 * One email per (conversation, recipient) — never one per message. The delay in
 * notify-select is what makes a live back-and-forth produce none at all.
 */
export async function sendNewMessageEmail(input: {
  to: string
  group: NotifyGroup
  senderName: string
  recipientName: string
}): Promise<{ error: string | null }> {
  if (!process.env.RESEND_API_KEY) return { error: "RESEND_API_KEY not configured" }
  if (!input.to) return { error: "recipient has no email address" }

  const link =
    input.group.recipient_role === "admin"
      ? `${baseUrl()}/admin/messages?conversation=${input.group.conversation_id}`
      : `${baseUrl()}/client/messages`

  const { error } = await _resend.emails.send({
    from: FROM_EMAIL,
    to: input.to,
    subject: newMessageSubject(input.group, input.senderName),
    html: newMessageHtml({ ...input, link }),
  })

  if (error) return { error: error.message ?? "Resend send failed" }
  return { error: null }
}
