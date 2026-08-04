// POST /api/admin/internal/messaging-notify
// Called by functions messagingNotifyCron (every 5 minutes).
//
// Emails a recipient only when a message is STILL unread after the delay, and
// bundles a burst into one email per conversation. This route is the SINGLE
// cron_runs owner under "messagingNotifyCron" -- functions/ must not log.
import { NextRequest, NextResponse } from "next/server"
import { isCronSkipped } from "@/lib/db/system-settings"
import { createServiceRoleClient } from "@/lib/supabase"
import { logCronStart, logCronEnd } from "@/lib/db/cron-runs"
import { listConversationsForNotify } from "@/lib/db/conversations"
import { listUnnotifiedMessages, stampNotified } from "@/lib/db/messages"
import { alreadyReadIds, messagesNeedingEmail } from "@/lib/messaging/notify-select"
import { sendNewMessageEmail } from "@/lib/messaging/email-new-message"
import { EMAIL_DELAY_MS, MESSAGING_EMAIL_CRON_KEY } from "@/lib/messaging/config"
import { getPreferences } from "@/lib/db/notification-preferences"
import { getUserById } from "@/lib/db/users"

export const runtime = "nodejs"
export const maxDuration = 120

function displayName(user: { first_name?: string | null; last_name?: string | null } | null, fallback: string) {
  const name = [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim()
  return name || fallback
}

export async function POST(request: NextRequest) {
  const expected = process.env.INTERNAL_CRON_TOKEN
  const authHeader = request.headers.get("authorization") ?? ""
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : ""
  if (!expected || !bearer || bearer !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const gate = await isCronSkipped({ enabledKey: MESSAGING_EMAIL_CRON_KEY, defaultEnabled: false })
  if (gate.skipped) return NextResponse.json({ skipped: gate.reason }, { status: 200 })

  const supabase = createServiceRoleClient()
  const runId = await logCronStart(supabase, "messagingNotifyCron")

  try {
    const now = Date.now()
    // Only messages already past the delay can matter, so the query does that
    // filtering rather than hauling every un-notified row into memory.
    const messages = await listUnnotifiedMessages(new Date(now - EMAIL_DELAY_MS).toISOString())
    if (messages.length === 0) {
      await logCronEnd(supabase, runId, "success", { emailed: 0, stamped: 0 })
      return NextResponse.json({ ok: true, emailed: 0, stamped: 0 })
    }

    const conversations = await listConversationsForNotify([...new Set(messages.map((m) => m.conversation_id))])
    const input = { messages, conversations, now, delayMs: EMAIL_DELAY_MS }

    const groups = messagesNeedingEmail(input)
    // Read before the delay elapsed: never email, but DO stamp -- an unstamped
    // read message is reconsidered on every run, forever.
    const stamp: string[] = [...alreadyReadIds(input)]
    let emailed = 0
    const failures: string[] = []

    for (const group of groups) {
      const senderId = messages.find((m) => m.id === group.message_ids[0])?.sender_user_id ?? null
      const sender = senderId ? await getUserById(senderId).catch(() => null) : null

      let to: string | null = null
      let recipientName = "there"

      if (group.recipient_role === "admin") {
        to = process.env.COACH_EMAIL ?? null
        recipientName = "Coach"
      } else if (group.recipient_user_id) {
        const preferences = await getPreferences(group.recipient_user_id).catch(() => null)
        // Opted out: skip the send but still stamp, or this group is
        // reconsidered on every run for the rest of time.
        if (preferences && preferences.email_notifications === false) {
          stamp.push(...group.message_ids)
          continue
        }
        const recipient = await getUserById(group.recipient_user_id).catch(() => null)
        to = recipient?.email ?? null
        recipientName = displayName(recipient, "there")
      }

      if (!to) {
        stamp.push(...group.message_ids)
        continue
      }

      const { error } = await sendNewMessageEmail({
        to,
        group,
        senderName: displayName(sender, group.recipient_role === "admin" ? "Your client" : "Darren"),
        recipientName,
      })

      if (error) {
        // Leave it unstamped so the next run retries rather than silently
        // dropping the notification.
        failures.push(`${group.conversation_id}: ${error}`)
        continue
      }

      emailed += 1
      stamp.push(...group.message_ids)
    }

    await stampNotified(stamp)
    // A send failure marks the whole run failed even when others succeeded --
    // that is what puts it in front of the automation-health watchdog. The
    // counts in the detail say how much actually got through.
    await logCronEnd(supabase, runId, failures.length > 0 ? "failed" : "success", {
      emailed,
      stamped: stamp.length,
      failures,
    })
    return NextResponse.json({ ok: true, emailed, stamped: stamp.length, failures })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[messaging-notify] failed:", err)
    await logCronEnd(supabase, runId, "failed", { message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
