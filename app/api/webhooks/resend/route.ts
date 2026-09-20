// app/api/webhooks/resend/route.ts — what Resend tells us about an email
// after it left (G09, ledger 2026-09-19 D6).
//
// `sequence_messages.delivered_at / opened_at / clicked_at` have existed since
// migration 00216 and had NO writer, so the quotation's "branch on whether
// they opened the last email" could never be true: the column it reads was
// always null. This is that writer.
//
// THE SIGNATURE IS THE ONLY AUTHORISATION. There is no session and no bearer
// token, exactly like the Calendly and Twilio webhooks beside it. A forged
// delivery could mark any message opened — and through the bounce arm,
// suppress any address the engine knows — so the verification is not a
// formality. Three rules, all of which the route's shape depends on:
//
//   1. `request.text()` BEFORE any JSON parsing. The signed bytes are the RAW
//      body; a re-serialised one is not the signed body. (A compact-JSON round
//      trip was once the only survivor of a mutation sweep on the Calendly
//      route — the same mistake, caught late.)
//   2. A bad signature answers 403 having read nothing and written nothing.
//   3. A MISSING SECRET answers 500, not 403. A deployment without the env var
//      is an operator fault, and 403 would bury it under "invalid signature"
//      while telling Svix to stop retrying. A 5xx is retried and is visibly
//      ours.
//
// 200 IS THE DEFAULT ANSWER for anything that verifies. Resend fires for every
// email the account sends, and most have no `sequence_messages` row at all —
// all the transactional mail. Answering non-2xx to those would make Svix retry
// a delivery that can never match, forever.

import { NextResponse } from "next/server"
import { applyResendEmailEvent, sequenceMessageRecipient } from "@/lib/db/sequences"
import { recordAudit } from "@/lib/audit/record"
import { suppress } from "@/lib/db/contact-consents"
import {
  verifySvixSignature,
  SVIX_ID_HEADER,
  SVIX_TIMESTAMP_HEADER,
  SVIX_SIGNATURE_HEADER,
} from "@/lib/resend/signature"

/**
 * Only the events that change something we read. `email.sent` duplicates what
 * `markSent` already wrote; `email.delivery_delayed` is not an outcome; and
 * `email.complained` (a spam report) deliberately does NOT suppress here.
 * That reads oddly beside a permanent bounce that does — a complaint is a
 * STRONGER stop signal than a dead mailbox — and it is a deferral, not an
 * oversight: a complaint should probably also revoke consent and exit the
 * runs, which is a different blast radius and belongs in its own row.
 */
const EVENT_KINDS: Record<string, "delivered" | "opened" | "clicked" | "bounced"> = {
  "email.delivered": "delivered",
  "email.opened": "opened",
  "email.clicked": "clicked",
  "email.bounced": "bounced",
}

type ResendEvent = {
  type?: unknown
  created_at?: unknown
  data?: { email_id?: unknown; to?: unknown; bounce?: { type?: unknown; subType?: unknown } }
}

/** The event's own instant, never the moment we processed it — Svix retries. */
function eventInstant(raw: unknown): Date {
  if (typeof raw === "string") {
    const parsed = new Date(raw)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  return new Date()
}

/**
 * Is this bounce a reason to stop writing to the address FOREVER?
 *
 * Only `Permanent` is. Resend reports `data.bounce.type` as `Permanent`,
 * `Transient` or `Undetermined`, and the Transient subtypes are things that
 * pass: `MailboxFull`, `MessageTooLarge`, `ContentRejected`,
 * `AttachmentRejected`, and a plain `General` that Resend's own docs say may
 * simply be an autoresponder.
 *
 * WHY THIS IS NOT A ONE-COLUMN DETAIL. `suppress` is keyed on the identifier,
 * has no expiry, and `loadRunContext` turns an email suppression into
 * `isSuppressed`, which exits the WHOLE run — not just the email channel —
 * and also blocks the SMS consent path. There is no admin screen to undo it:
 * the only `unsuppress` caller is the Twilio START handler, which an email
 * suppression can never reach, so recovery means a script or hand-written SQL.
 * One full mailbox or one out-of-office would eject a live lead from every
 * sequence, permanently and invisibly.
 *
 * `Undetermined` deliberately does NOT suppress. The cost of being wrong is
 * asymmetric: a retained address that keeps bouncing is visible in Resend and
 * costs reputation slowly; a suppressed address that should not be is an
 * invisible, unrecoverable lost lead.
 */
function isPermanentBounce(bounce: { type?: unknown } | undefined): boolean {
  return typeof bounce?.type === "string" && bounce.type.toLowerCase() === "permanent"
}

export async function POST(request: Request) {
  // RAW body first. Nothing above this line may parse it.
  const body = await request.text()

  // Both header spellings. Resend sends `svix-*` today, but Svix serves the
  // white-labelled `webhook-*` names on some plans, and if Resend ever flips
  // the endpoint would 403 every delivery with nothing in the logs to explain
  // it. The official Svix libraries accept both for the same reason.
  const header = (name: string, alt: string) => request.headers.get(name) ?? request.headers.get(alt)

  const verdict = verifySvixSignature({
    secret: process.env.RESEND_WEBHOOK_SECRET,
    id: header(SVIX_ID_HEADER, "webhook-id"),
    timestamp: header(SVIX_TIMESTAMP_HEADER, "webhook-timestamp"),
    signatureHeader: header(SVIX_SIGNATURE_HEADER, "webhook-signature"),
    body,
  })

  if (!verdict.ok) {
    if (verdict.reason === "not_configured") {
      console.error("[resend-webhook] RESEND_WEBHOOK_SECRET is not set; refusing to trust any delivery")
      return NextResponse.json({ error: "webhook not configured" }, { status: 500 })
    }
    // The REASON is logged, not returned: telling a prober whether their
    // timestamp landed inside the tolerance window is free information.
    console.warn(`[resend-webhook] rejected a delivery: ${verdict.reason}`)
    return NextResponse.json({ error: "invalid signature" }, { status: 403 })
  }

  let event: ResendEvent
  try {
    event = JSON.parse(body) as ResendEvent
  } catch {
    // Signed, so it came from Resend — but unparseable. Retrying will not fix
    // it, so 200 rather than inviting an infinite redelivery.
    console.error("[resend-webhook] signed delivery had an unparseable body")
    return NextResponse.json({ ok: true, ignored: "unparseable" })
  }

  const kind = typeof event.type === "string" ? EVENT_KINDS[event.type] : undefined
  const emailId = typeof event.data?.email_id === "string" ? event.data.email_id : null
  if (!kind || !emailId) {
    return NextResponse.json({ ok: true, ignored: typeof event.type === "string" ? event.type : "unknown" })
  }

  const outcome = await applyResendEmailEvent(emailId, kind, eventInstant(event.created_at))

  // A PERMANENT BOUNCE SUPPRESSES THE ADDRESS — and only a permanent one; see
  // `isPermanentBounce` for why a soft bounce must not. The mailbox does not
  // exist, and continuing to write to it damages the sending reputation every
  // other contact's deliverability rests on. The row is marked `failed` either
  // way, which is a visible record without being a life sentence.
  //
  // The address AND the tenant both come from the message ROW, never the
  // payload: suppression is keyed on the identifier so it survives a merge,
  // which means nothing in the suppression itself carries a business. No row,
  // no suppression — guessing a tenant here would be a cross-tenant write
  // driven by an unauthenticated endpoint.
  //
  // Non-blocking. The engagement row above is already written, and a 5xx would
  // make Svix redeliver and re-apply everything.
  if (kind === "bounced" && isPermanentBounce(event.data?.bounce) && outcome !== "unknown_message") {
    try {
      const recipient = await sequenceMessageRecipient(emailId)
      if (recipient) {
        await suppress(recipient.toIdentifier, "bounced", recipient.businessId)
        // An UNAUTHENTICATED public endpoint just suppressed an address, which
        // is the same shape as the unsubscribe link — "who did this, to whom,
        // and when" has to be answerable from the audit trail. No address in
        // the metadata; the message id is enough to find it.
        await recordAudit({
          action: "marketing.unsubscribed",
          category: "compliance",
          outcome: "success",
          actor: { id: null, email: null, role: "system" },
          // The MESSAGE, not a contact: this route resolves a message row,
          // never a contact id, and naming a target we did not look up would
          // be a guess in the one trail that exists to answer "to whom".
          target: { type: "sequence_message", id: emailId },
          metadata: {
            business_id: recipient.businessId,
            channel: "email",
            source: "resend_bounce",
            provider_message_id: emailId,
            bounce_subtype: typeof event.data?.bounce?.subType === "string" ? event.data.bounce.subType : null,
          },
        })
      }
    } catch (err) {
      console.error("[resend-webhook] bounce suppression failed", (err as Error).message)
    }
  }

  return NextResponse.json({ ok: true, outcome })
}
