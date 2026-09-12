// app/api/admin/sms/send/route.ts — the manual send.
//
// THIS ROUTE IS THE GUARD. The compose box is disabled for a suppressed
// number too, but a guard on the client path is not a guard: if the claim is
// "no surface can text a suppressed number", this is what has to enforce it.
// Its suppression test runs with the UI out of the picture for exactly that
// reason.
//
// `sentBy` comes from `auth()`'s session, NOT from `currentActor()`.
// `currentActor()` (lib/permissions/guard.ts) returns only `{ role,
// permissions }` — `PermissionActor.id` is optional and this function never
// populates it. `currentActor()` is kept for the permission check only, the
// same split `app/api/admin/pipeline/move/route.ts` uses (session for
// identity, the registry for the access decision).
//
// TWO AUDIT SLUGS, deliberately not one. `withAudit` below always writes
// `sms.sent_manual` — the generic "someone hit this endpoint" row every
// admin route emits, the same convention `pipeline/move/route.ts` documents
// (its own header calls that row "intentionally redundant" with a more
// specific one). A refusal (suppressed or unconfigured) is a business event
// worth its OWN slug, not a `sent_manual` row with `outcome: failure` —
// that's a send action pretending a send happened. `recordAudit()` is called
// inline in the catch block for exactly those two branches, on top of (not
// instead of) the wrapper's row.
//
// `contactId`, if supplied, is checked against `businessId` via
// `getContactById` BEFORE the send: this product is heading for multi-tenant
// white-label, and the house rule is every new reader gets a tenant
// predicate. Without this check a contact id from another business could be
// stitched into this business's SMS thread (not a cross-tenant READ leak —
// the row's own business_id is still the caller's — but a foreign key with
// no ownership check is exactly the kind of gap that rule exists to close).

import { NextResponse } from "next/server"
import { z } from "zod"
import { withAudit } from "@/lib/audit/with-audit"
import { recordAudit } from "@/lib/audit/record"
import { auth } from "@/lib/auth"
import { currentActor } from "@/lib/permissions/guard"
import { canAccessPath } from "@/lib/permissions/registry"
import { resolveAdminTenantForRequest } from "@/lib/tenancy/resolve"
import { getBusinessSettings } from "@/lib/db/businesses"
import { recentOutboundExists } from "@/lib/db/sms-messages"
import { normalisePhone } from "@/lib/lead-engine/identity"
import { getContactById } from "@/lib/db/contact-detail"
import {
  sendManualSms,
  SmsSuppressedError,
  SmsNotConfiguredError,
  SmsTooLongError,
  SmsUnparseablePhoneError,
} from "@/lib/lead-engine/sms"
import { appOrigin } from "@/lib/lead-engine/origin"

const sendSchema = z.object({
  phone: z.string().regex(/^\+[1-9]\d{7,14}$/, "phone must be E.164"),
  body: z.string().trim().min(1, "message is empty").max(1600),
  contactId: z.string().uuid().optional(),
  // Spec §3.1: quiet hours WARN, they do not block. The client sets this
  // after the second click, and it never refuses the send — it is recorded
  // on the `sms.sent_manual` audit row instead (via the `x-audit-*` header
  // below), because "the admin was warned and sent anyway" is a real
  // business event worth keeping.
  confirmQuietHours: z.boolean().optional(),
})

export const POST = withAudit(
  {
    action: "sms.sent_manual",
    category: "marketing",
    metadata: async (_req, res) => {
      const meta: Record<string, unknown> = {}
      const id = res.headers.get("x-audit-target-id")
      if (id) meta.target_id = id
      if (res.headers.get("x-audit-quiet-hours-confirmed") === "true") {
        meta.confirmed_quiet_hours = true
      }
      return meta
    },
  },
  async (request: Request) => {
    const actor = await currentActor()
    if (!actor || !canAccessPath(actor, "/api/admin/sms/send", "POST")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    // The identity for `sentBy` comes from the session, never from `actor`
    // (see the file header — `currentActor()` never carries an id).
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { businessId } = await resolveAdminTenantForRequest(request)

    let payload: unknown
    try {
      payload = await request.json()
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
    }

    const parsed = sendSchema.safeParse(payload)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const { phone, body, contactId, confirmQuietHours } = parsed.data

    // A contact id is trusted straight through to `insertSmsMessage`'s
    // thread. Confirm it is THIS business's contact before it can be
    // stitched into this business's SMS history.
    if (contactId) {
      const contact = await getContactById(contactId, businessId)
      if (!contact) {
        return NextResponse.json(
          { error: "That contact was not found for this business.", reason: "contact_not_found" },
          { status: 400 },
        )
      }
    }

    const settings = await getBusinessSettings(businessId)

    try {
      // Spec §3.2: the opt-out sentence goes on the first outbound to this
      // number in a rolling 30 days, not on every reply. Normalised once,
      // here — every write below (via sendManualSms) keys on the SAME
      // normalised value, so a trunk-prefixed variant of an otherwise
      // ordinary E.164 number (e.g. "+4402071838750" -> "+442071838750")
      // cannot look like a first-ever text to a number that was just
      // texted, and redundantly append the opt-out sentence. Falls back to
      // the raw value only when it fails to normalise at all — the same
      // input sendManualSms itself will then reject as unparseable.
      const normalisedPhone = normalisePhone(phone) ?? phone
      const appendOptOut = !(await recentOutboundExists(normalisedPhone, businessId))

      const result = await sendManualSms({
        phone,
        body,
        settings,
        businessId,
        contactId: contactId ?? null,
        sentBy: session.user.id,
        appendOptOut,
        statusCallbackUrl: `${appOrigin()}/api/webhooks/twilio/status`,
      })

      // `messageId` is `string | null`: null means the text went out but the
      // post-send record write failed. Reporting this as a plain 200 is
      // still correct (see the comment on sendManualSms — a delivered text
      // must never be reported as failed), but a silent 200 left the admin
      // with no explanation: the composer clears the box and refreshes, and
      // the message just isn't there. `warning` is what carries that
      // explanation across the wire; SmsComposer surfaces it instead of
      // pretending nothing happened.
      const res = NextResponse.json({
        id: result.messageId,
        providerMessageId: result.providerMessageId,
        text: result.text,
        ...(result.messageId
          ? {}
          : {
              warning:
                "The text was sent, but it could not be saved to this conversation. It may not appear in the thread below.",
            }),
      })
      // Only point the audit trail at a row that actually exists.
      if (result.messageId) {
        res.headers.set("x-audit-target-id", result.messageId)
      }
      if (confirmQuietHours) {
        res.headers.set("x-audit-quiet-hours-confirmed", "true")
      }
      return res
    } catch (err) {
      if (err instanceof SmsSuppressedError) {
        await recordAudit({
          action: "sms.send_refused",
          category: "marketing",
          outcome: "failure",
          request,
          metadata: { reason: "suppressed", phone },
        })
        return NextResponse.json(
          {
            error: "This number has opted out of texts. You cannot message them.",
            reason: "suppressed",
          },
          { status: 409 },
        )
      }
      if (err instanceof SmsNotConfiguredError) {
        await recordAudit({
          action: "sms.send_refused",
          category: "marketing",
          outcome: "failure",
          request,
          metadata: { reason: "not_configured", phone, missing: err.missing },
        })
        return NextResponse.json(
          {
            error: "Texting is not set up for this business yet.",
            reason: "not_configured",
          },
          { status: 503 },
        )
      }
      if (err instanceof SmsTooLongError) {
        // A caller input error, not a provider fault: a 502 here would tell
        // the admin to try again later, which shortening a message is the
        // only thing that fixes.
        return NextResponse.json(
          {
            error: `That message is ${err.segments} segments — shorten it to ${err.maxSegments} or fewer.`,
            reason: "too_long",
          },
          { status: 400 },
        )
      }
      if (err instanceof SmsUnparseablePhoneError) {
        return NextResponse.json(
          {
            error: "That does not look like a valid phone number.",
            reason: "invalid_phone",
          },
          { status: 400 },
        )
      }
      const message = err instanceof Error ? err.message : "Send failed"
      return NextResponse.json({ error: message, reason: "send_failed" }, { status: 502 })
    }
  },
)
