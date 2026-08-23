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
// WHAT THE DURABLE ROWS ARE ALLOWED TO SAY
//
// Three tables hold something about a handover, and they do NOT expire
// together:
//
//   chat_messages             chat_retention_days              90
//   audit_logs                audit_log_retention_days        365
//   contact_timeline_events   contact_timeline_retention_days 365
//
// `summary` is model-authored prose in the good case and THE VISITOR'S OWN
// MESSAGE in the common one — the caller falls back to it when the assistant
// asks for a person without writing a sentence. A visitor who is handed over
// is very often one who asked about an injury, so that sentence is the most
// sensitive thing this feature holds.
//
// So it is EMAILED and it is NOT STORED. Copying it into either 365-day table
// would give it the longest life of anything in the feature, in tables the
// retention design was never written about, and `lib/audit/scrub.ts` would not
// catch it — that scrubber redacts `password|token|secret|api_key` and nothing
// else. Both durable rows therefore record THAT a handover happened and carry
// the ids to go and read it; the words themselves stay in `chat_messages`,
// which is the table with the 90-day window and the admin transcript over it.
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
  /**
   * What the visitor wanted, in the assistant's words — or, when it did not
   * write any, in the visitor's own. EMAILED TO THE OPERATOR AND NEVER
   * STORED: see the header. Nothing downstream of here may put it in a row.
   */
  summary: string
  businessId?: string
}

/**
 * Appends the handover to the contact's history.
 *
 * `contact_timeline_events.contact_id` is NOT NULL, so this is only reachable
 * once a capture has linked a contact to the conversation. Failure is logged
 * and swallowed, the same contract `recordContactEvent` follows: history is
 * not the record of what happened here — `escalated_at` is, and it is already
 * written by the time this runs.
 *
 * THE ROW CARRIES NO SUMMARY, ON PURPOSE. `kind` already says a handover
 * happened and `conversation_id` says which one, which is everything anybody
 * reading this contact's history needs in order to open the transcript. The
 * words live in `chat_messages` for 90 days; this table keeps them for 365.
 * See the file header.
 */
async function writeTimelineEvent(args: {
  businessId: string
  contactId: string
  conversationId: string
}): Promise<boolean> {
  const { error } = await createServiceRoleClient()
    .from("contact_timeline_events")
    .insert({
      business_id: args.businessId,
      contact_id: args.contactId,
      kind: CHAT_ESCALATION_TIMELINE_KIND,
      source: CHAT_LEAD_SOURCE,
      metadata: { conversation_id: args.conversationId },
    })

  if (error) {
    // Never log the raw error object, the same rule the send failure below
    // states. A PostgREST constraint violation echoes the failing row back in
    // `details` and advice about it in `hint`, and Vercel's logs are the
    // destination — so a row this insert never even landed can still put the
    // conversation on a log line. `code` and `message` identify which
    // constraint refused it and carry nothing from the payload.
    const e = error as { code?: unknown; message?: unknown } | null | undefined
    console.error(
      `[chat-escalate] timeline event failed for contact ${args.contactId} (conversation ${args.conversationId})`,
      {
        code: typeof e?.code === "string" ? e.code : undefined,
        message: typeof e?.message === "string" ? e.message : undefined,
      },
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
    timelineEvent = await writeTimelineEvent({ businessId, contactId, conversationId })
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
  // from reaching for a NextAuth session that cannot exist. NO VISITOR TEXT AT
  // ALL and no IP: `target` names the conversation, and that is the pointer to
  // the transcript for as long as the transcript exists. `ip_hash` on the
  // conversation row is the only origin identifier this subsystem keeps.
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
    },
  })

  return { ok: true, contactId, notice, timelineEvent }
}
