// lib/lead-engine/chat/escalate.ts — the one write among the assistant's
// tools, and the only one that reaches outside the chat tables.
//
// NO BRAND NAMES ANYWHERE IN THIS DIRECTORY, comments included. Business
// identity is read from `getBusinessSettings()` and passed as a parameter.
// `__tests__/lib/lead-engine/no-brand-literals.test.ts` enforces it.
//
// WHY THE ORDER IS THE DESIGN
//
// Escalating means a visitor is about to be told that a person will be in
// touch. That sentence is a promise, and a promise needs somewhere it is
// written down. So:
//
//   1. `markEscalated` runs FIRST and is allowed to fail loudly. `escalated_at`
//      is the durable record and it is what `/admin/chat` lists; if it cannot
//      be written there is no escalation, and the caller must not tell the
//      visitor otherwise.
//   2. Everything after it is BEST EFFORT and is caught: the contact timeline
//      row, the transcript email, the audit row. A mail provider that is down
//      — or a `business_settings.reply_to` that was never filled in — must not
//      be able to swallow the fact that somebody asked for help.
//
// That second point is measured, not defensive: `business_settings.reply_to`
// is the EMPTY STRING in the dev clone, and whether production matches could
// not be checked from this environment. An unconfigured reply-to is therefore
// a live path with a name of its own (`not_configured`), reported back to the
// caller rather than logged and forgotten — because the difference between
// "we emailed a person" and "there was nobody to email" is exactly the
// difference between keeping that promise and making it up.
//
// Spec: docs/superpowers/specs/2026-08-23-lead-engine-stage3-chat-design.md §5.3

import { getBusinessSettings } from "@/lib/db/businesses"
import { getConversation, listMessages, markEscalated } from "@/lib/db/chat"
import { sendChatEscalationEmail } from "@/lib/email"
import { recordAudit } from "@/lib/audit/record"
import { createServiceRoleClient } from "@/lib/supabase"
import { CHAT_LEAD_SOURCE } from "./constants"

// Type-only, so the closed audit taxonomy is checked at compile time. A slug
// that is not a row in `AUDIT_ACTIONS` stops the build instead of writing an
// audit row nothing can read back by name.
import type { AuditAction } from "@/lib/audit/actions"

/** `contact_timeline_events.kind` for a handover. */
export const CHAT_ESCALATION_TIMELINE_KIND = "chat_escalated"

const ESCALATION_AUDIT_ACTION: AuditAction = "chat.escalated"

/**
 * How long a stored summary may be.
 *
 * The summary is model-authored prose, and `audit_logs` metadata is capped at
 * 8KB by the scrubber. It is CLAMPED rather than rejected: a validation error
 * here would throw away an escalation that has already been written, which is
 * the opposite of what this file is for. The email carries the whole thing —
 * the clamp is a storage limit, not a censor.
 */
const MAX_STORED_SUMMARY = 500

/** What happened to the person on the other end of the handover. */
export type EscalationNotice =
  /** A message left this process for a real address. */
  | "sent"
  /** There was nobody to email: no `reply_to`, or no mail provider configured. */
  | "not_configured"
  /** There was an address, and telling them failed anyway. */
  | "failed"

export type EscalationOutcome =
  | {
      ok: true
      contactId: string | null
      notice: EscalationNotice
      timelineEvent: boolean
    }
  | { ok: false; reason: "conversation_not_found" | "already_escalated" }

export interface RunEscalationInput {
  conversationId: string
  /** What the visitor wanted, in the assistant's words. */
  summary: string
  businessId?: string
}

function clampSummary(summary: string): string {
  return summary.length <= MAX_STORED_SUMMARY ? summary : `${summary.slice(0, MAX_STORED_SUMMARY - 1)}…`
}

/**
 * Appends the handover to the contact's history.
 *
 * `contact_timeline_events.contact_id` is NOT NULL, so this is only reachable
 * once a capture has linked a contact to the conversation. Failure is logged
 * and swallowed, the same contract `recordContactEvent` follows: history is
 * not the record of what happened here — `escalated_at` is, and it is already
 * written by the time this runs.
 */
async function writeTimelineEvent(args: {
  businessId: string
  contactId: string
  conversationId: string
  summary: string
}): Promise<boolean> {
  const { error } = await createServiceRoleClient()
    .from("contact_timeline_events")
    .insert({
      business_id: args.businessId,
      contact_id: args.contactId,
      kind: CHAT_ESCALATION_TIMELINE_KIND,
      source: CHAT_LEAD_SOURCE,
      metadata: { conversation_id: args.conversationId, summary: args.summary },
    })

  if (error) {
    console.error(
      `[chat-escalate] timeline event failed for contact ${args.contactId} (conversation ${args.conversationId})`,
      error,
    )
    return false
  }
  return true
}

/**
 * Hands one conversation to a person, once.
 *
 * Capped per conversation by the `escalated_at` read below rather than by
 * `markEscalated`'s own `.is("escalated_at", null)` guard. That guard makes
 * the WRITE idempotent; it cannot stop a second transcript email landing in
 * the operator's inbox, and an assistant that calls its escalate tool twice in
 * one conversation is not unusual.
 *
 * A failed conversation READ throws rather than being reported as
 * `conversation_not_found`: "the database was unreachable" and "no such
 * conversation" are different answers, and conflating them turns an outage
 * into a silently dropped escalation.
 */
export async function runEscalation(input: RunEscalationInput): Promise<EscalationOutcome> {
  const { conversationId, summary } = input

  const conversation = await getConversation(conversationId)
  if (!conversation) return { ok: false, reason: "conversation_not_found" }
  if (conversation.escalated_at !== null) return { ok: false, reason: "already_escalated" }

  const businessId = input.businessId ?? conversation.business_id
  const contactId = conversation.contact_id

  // THE DURABLE RECORD. Uncaught on purpose — see the file header.
  await markEscalated(conversationId)

  let timelineEvent = false
  if (contactId) {
    timelineEvent = await writeTimelineEvent({
      businessId,
      contactId,
      conversationId,
      summary: clampSummary(summary),
    })
  }

  let notice: EscalationNotice = "failed"
  try {
    const settings = await getBusinessSettings(businessId)
    const replyTo = (settings.reply_to ?? "").trim()

    if (replyTo.length === 0) {
      // An empty string satisfies `to: string` and is a hard provider error at
      // send time. Naming it here keeps the reason in the outcome instead of
      // in a stack trace.
      console.warn(
        `[chat-escalate] conversation ${conversationId} escalated with no reply_to configured — nobody was emailed`,
      )
      notice = "not_configured"
    } else {
      const transcript = await listMessages(conversationId)
      const { delivered } = await sendChatEscalationEmail({
        to: replyTo,
        conversationId,
        summary,
        transcript,
        landingPath: conversation.landing_path,
        contactId,
      })
      notice = delivered ? "sent" : "not_configured"
    }
  } catch (err) {
    // Never log the raw thrown value: a provider error can echo the recipient
    // address back, and a transcript read failure can carry visitor text.
    const e = err as { message?: unknown } | null | undefined
    console.error(`[chat-escalate] could not notify anyone about conversation ${conversationId}`, {
      message: typeof e?.message === "string" ? e.message : undefined,
    })
    notice = "failed"
  }

  // The trail records what ACTUALLY happened, not that an escalation was
  // requested — `notice` is the difference between a promise kept and a
  // promise made into the void, and it is the first thing anybody debugging a
  // missed lead will want.
  //
  // Actor `system`: nobody is signed in. This runs from an unauthenticated
  // public endpoint, and passing an explicit actor also keeps `recordAudit`
  // from reaching for a NextAuth session that cannot exist. No visitor text
  // beyond the clamped summary, and no IP — `ip_hash` on the conversation row
  // is the only origin identifier this subsystem keeps.
  await recordAudit({
    action: ESCALATION_AUDIT_ACTION,
    category: "marketing",
    outcome: "success",
    actor: { id: null, email: null, role: "system" },
    target: { type: "chat_conversation", id: conversationId },
    metadata: {
      business_id: businessId,
      notice,
      contact_id: contactId,
      timeline_event: timelineEvent,
      summary: clampSummary(summary),
    },
  })

  return { ok: true, contactId, notice, timelineEvent }
}
