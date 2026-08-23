// POST /api/ask/capture — the visitor's own click on the details card the chat
// assistant put on screen.
//
// THIS IS THE ONLY PATH IN THE CHAT FEATURE THAT CAN CREATE A CONTACT.
//
// That is a structural claim, not a policy: the `capture_lead` tool the model
// can call returns a card instruction and nothing else, and no tool in
// `lib/lead-engine/chat/tools.ts` has a write path at all (a source scan pins
// it). So a prompt injection that gets all the way through to a tool call
// still cannot file a contact, a consent row, or a charge. Everything the
// feature promises about consent therefore rests on this file.
//
// /api/* is NOT covered by middleware.ts, so this route gates itself — and a
// public gate that fails closed answers 404, never a redirect.
//
// THE CONSENT DISCIPLINE, WHICH IS COPIED FROM app/api/funnels/submit/route.ts
//
//   The wording filed on the consent row is RE-RENDERED HERE, server-side,
//   from `business_settings.display_name`, through the same
//   `renderChatMarketingWording` the card used to show it. It is never taken
//   from the request: the schema in `lib/validators/chat.ts` does not even
//   have a field for it. Evidence of consent is what the visitor was actually
//   shown, and re-deriving it from the same input is how both halves of that
//   claim stay provably identical. A sentence relayed by the browser proves
//   only that the browser was willing to type a sentence.
//
//   `hasChatConsentDisplayName` gates the row, mirroring the identical gate
//   the card renderer asks before it draws the tick at all. Blank name → no
//   tick and no row. One verdict on both sides, or the sentence displayed and
//   the sentence recorded can disagree — exactly the mismatch the pattern
//   exists to rule out. This is a live path: `business_settings.display_name`
//   is the empty string in the dev clone and in production.
//
//   THE CONTACT IS ALWAYS CREATED; THE CONSENT ROW IS NOT. Submitting the card
//   means "I am asking to be contacted about my question", which justifies a
//   human reply and is recorded as such on the contact spine. Marketing
//   consent is a second, separate agreement. Unticked means no
//   `contact_consents` row exists at all — which is what keeps the sequence
//   engine away from them.
//
// Spec: docs/superpowers/specs/2026-08-23-lead-engine-stage3-chat-design.md §5.1

import { NextResponse } from "next/server"
import { getSetting } from "@/lib/db/system-settings"
import { getConversation, markCaptured } from "@/lib/db/chat"
import { captureLead } from "@/lib/lead-engine/capture"
import { recordConsent } from "@/lib/db/contact-consents"
import { getBusinessSettings } from "@/lib/db/businesses"
import { recordAudit } from "@/lib/audit/record"
import { askCaptureSchema } from "@/lib/validators/chat"
import { CHAT_ASSISTANT_FLAG, CHAT_ASSISTANT_FLAG_DEFAULT, CHAT_LEAD_SOURCE } from "@/lib/lead-engine/chat/constants"
import { hasChatConsentDisplayName, renderChatMarketingWording } from "@/lib/lead-engine/chat/consent-wording"

// Type-only, so the closed audit taxonomy is checked at compile time rather
// than at write time: a slug that is not a row in `AUDIT_ACTIONS` stops the
// build instead of writing a row nothing can look up by name.
import type { AuditAction } from "@/lib/audit/actions"

const CAPTURE_AUDIT_ACTION: AuditAction = "chat.lead_captured"

/**
 * Every rejection reads back to a visitor who has just typed their name in.
 * None of these name a field or echo a validator message — a form that is one
 * sentence long does not need a field-level error, and a public endpoint has
 * no reason to describe its own schema.
 */
const COPY = {
  notFound: "Not found.",
  invalid: "Please add your name, and either an email address or a phone number.",
  unknownConversation: "That conversation has expired. Start a new one and I'll pick it up from there.",
  alreadyCaptured: "I already have your details for this conversation — someone will be in touch.",
  failed: "Something went wrong saving your details. Please try again.",
} as const

export async function POST(request: Request) {
  // 1. The feature flag, first and before anything is read or parsed.
  const enabled = await getSetting<boolean>(CHAT_ASSISTANT_FLAG, CHAT_ASSISTANT_FLAG_DEFAULT)
  if (!enabled) return NextResponse.json({ error: COPY.notFound }, { status: 404 })

  // 2. The body. A malformed one and a schema-invalid one are the same answer.
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: COPY.invalid }, { status: 400 })
  }

  const parsed = askCaptureSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: COPY.invalid }, { status: 400 })
  }
  const { conversationId, name, email, phone, marketingConsent } = parsed.data

  // 3. The conversation. A FAILED READ IS NOT AN ABSENT ROW: `getConversation`
  //    throws on a read error and returns null only for "no such row", so the
  //    two answers stay apart. Reporting an outage as "that conversation has
  //    expired" would tell the visitor to start again into the same outage.
  let conversation
  try {
    conversation = await getConversation(conversationId)
  } catch (err) {
    const e = err as { message?: unknown } | null | undefined
    console.error(`[ask/capture] could not read conversation ${conversationId}`, {
      message: typeof e?.message === "string" ? e.message : undefined,
    })
    return NextResponse.json({ error: COPY.failed }, { status: 500 })
  }

  if (!conversation) {
    return NextResponse.json({ error: COPY.unknownConversation }, { status: 404 })
  }

  // 4. One capture per conversation. Checked against `captured_at` — the
  //    timestamp `markCaptured` writes — rather than against `contact_id`,
  //    because that is the column that records the ACT rather than its result.
  if (conversation.captured_at !== null) {
    return NextResponse.json({ error: COPY.alreadyCaptured }, { status: 409 })
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null
  const userAgent = request.headers.get("user-agent")

  // 5. THE CONTACT. Always, regardless of the marketing tick: they asked to be
  //    contacted about their own question, and that is the record which
  //    justifies a person replying to them.
  //
  //    `captureLead` never throws — it swallows and logs its own failures — so
  //    `null` here means the write genuinely did not happen. Saying "saved"
  //    over the top of that would be the one lie this whole feature is built
  //    to avoid, so it is a 500 and the visitor is invited to try again.
  const contactId = await captureLead({
    source: CHAT_LEAD_SOURCE,
    name,
    email: email ?? null,
    phone: phone ?? null,
    metadata: {
      chat_conversation_id: conversationId,
      landing_path: conversation.landing_path,
      attribution_session_id: conversation.attribution_session_id,
    },
  })

  if (!contactId) {
    return NextResponse.json({ error: COPY.failed }, { status: 500 })
  }

  // 6. The link back to the conversation. Best effort, deliberately: the
  //    contact above is the durable record and it already exists, so a failure
  //    here must not turn a saved lead into an error the visitor sees. It is
  //    logged loudly because it is also what makes step 4 hold.
  try {
    await markCaptured(conversationId, contactId)
  } catch (err) {
    const e = err as { message?: unknown } | null | undefined
    console.error(`[ask/capture] contact ${contactId} saved but conversation ${conversationId} not linked`, {
      message: typeof e?.message === "string" ? e.message : undefined,
    })
  }

  // 7. The consent row — only for an actual consent act, and only when the
  //    sentence can name who is doing the emailing. See the file header.
  const marketingConsentRecorded =
    marketingConsent === true ? await fileMarketingConsent({ contactId, ip, userAgent }) : false

  // The trail records what happened, never who it happened to: no name, no
  // email, no phone, no IP. `chat_conversations.ip_hash` is the only origin
  // identifier this subsystem keeps, and the contact spine already holds the
  // identifiers — an audit row repeating them just spreads them into a second
  // table with its own retention.
  //
  // Actor `system`: nobody is signed in, and passing an explicit actor also
  // stops `recordAudit` reaching for a NextAuth session that cannot exist on a
  // public endpoint.
  await recordAudit({
    action: CAPTURE_AUDIT_ACTION,
    category: "marketing",
    outcome: "success",
    actor: { id: null, email: null, role: "anonymous" },
    target: { type: "chat_conversation", id: conversationId },
    metadata: {
      business_id: conversation.business_id,
      contact_id: contactId,
      marketing_consent: marketingConsent,
      marketing_consent_recorded: marketingConsentRecorded,
    },
  })

  // `marketingConsentRecorded` is returned so the panel can confirm what
  // actually happened rather than what was asked for. It is false whenever no
  // row was filed, and a surface that promises "you'll hear about camps" off
  // the back of a tick that filed nothing is making the promise up.
  return NextResponse.json({ ok: true, marketingConsentRecorded })
}

/**
 * Files the marketing consent row, and reports whether it actually landed.
 *
 * Returns false rather than throwing on every failure path, and there are
 * three of them, all treated identically ON PURPOSE:
 *
 *   - `business_settings.display_name` is blank, so the sentence cannot name
 *     the business and the card never rendered the tick;
 *   - the settings read failed, so we do not know whether it is blank —
 *     `hasChatConsentDisplayName`'s whole reason for existing is that "blank"
 *     and "could not tell" collapse to one verdict on both sides;
 *   - the insert failed.
 *
 * In all three, no row exists, so no marketing may be sent — the fail-safe
 * direction. And in none of them is the lead lost: the contact was written
 * before this ran, and a consent problem must never turn "we have your
 * details" into an error for somebody who has just handed them over.
 */
async function fileMarketingConsent(input: {
  contactId: string
  ip: string | null
  userAgent: string | null
}): Promise<boolean> {
  try {
    const settings = await getBusinessSettings()

    if (!hasChatConsentDisplayName(settings.display_name)) {
      console.warn("[ask/capture] marketing consent skipped: business_settings.display_name is blank")
      return false
    }

    await recordConsent({
      contactId: input.contactId,
      channel: "email",
      granted: true,
      source: CHAT_LEAD_SOURCE,
      // Re-rendered here, never relayed from the client. The file header
      // explains why that distinction is the entire point of this route.
      wordingShown: renderChatMarketingWording(settings.display_name),
      // The raw address, as every other consent-writing surface in the app
      // files it (`recordFunnelSmsConsent`, the newsletter route). A consent
      // row is evidence, and `contact_consents.ip_address` is part of the
      // evidence; the chat tables' hash-only rule is about the CHAT rows, and
      // it still holds — nothing here writes one.
      ip: input.ip,
      userAgent: input.userAgent,
    })
    return true
  } catch (err) {
    // Never log the raw thrown value: a Postgres error on the contact spine
    // can embed the submitted email inside a constraint violation's details.
    const e = err as { code?: unknown; message?: unknown } | null | undefined
    console.error(`[ask/capture] marketing consent row failed for contact ${input.contactId} (the lead was saved)`, {
      code: typeof e?.code === "string" ? e.code : undefined,
      message: typeof e?.message === "string" ? e.message : undefined,
    })
    return false
  }
}
