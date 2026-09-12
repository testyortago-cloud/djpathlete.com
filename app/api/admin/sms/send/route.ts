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

import { NextResponse } from "next/server"
import { z } from "zod"
import { withAudit } from "@/lib/audit/with-audit"
import { auth } from "@/lib/auth"
import { currentActor } from "@/lib/permissions/guard"
import { canAccessPath } from "@/lib/permissions/registry"
import { resolveAdminTenantForRequest } from "@/lib/tenancy/resolve"
import { getBusinessSettings } from "@/lib/db/businesses"
import { recentOutboundExists } from "@/lib/db/sms-messages"
import { sendManualSms, SmsSuppressedError, SmsNotConfiguredError } from "@/lib/lead-engine/sms"
import { appOrigin } from "@/lib/lead-engine/origin"

const sendSchema = z.object({
  phone: z.string().regex(/^\+[1-9]\d{7,14}$/, "phone must be E.164"),
  body: z.string().trim().min(1, "message is empty").max(1600),
  contactId: z.string().uuid().optional(),
  // Spec §3.1: quiet hours WARN, they do not block. The client sets this
  // after the second click; the route records it but never refuses on it.
  confirmQuietHours: z.boolean().optional(),
})

export const POST = withAudit(
  {
    action: "sms.sent_manual",
    category: "marketing",
    metadata: async (_req, res) => {
      const id = res.headers.get("x-audit-target-id")
      return id ? { target_id: id } : {}
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

    const { phone, body, contactId } = parsed.data
    const settings = await getBusinessSettings(businessId)

    // Spec §3.2: the opt-out sentence goes on the first outbound to this
    // number in a rolling 30 days, not on every reply.
    const appendOptOut = !(await recentOutboundExists(phone, businessId))

    try {
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

      const res = NextResponse.json({
        id: result.messageId,
        providerMessageId: result.providerMessageId,
        text: result.text,
      })
      // `messageId` is `string | null`: null means the text went out but the
      // post-send record write failed. Only point the audit trail at a row
      // that actually exists.
      if (result.messageId) {
        res.headers.set("x-audit-target-id", result.messageId)
      }
      return res
    } catch (err) {
      if (err instanceof SmsSuppressedError) {
        return NextResponse.json(
          {
            error: "This number has opted out of texts. You cannot message them.",
            reason: "suppressed",
          },
          { status: 409 },
        )
      }
      if (err instanceof SmsNotConfiguredError) {
        return NextResponse.json(
          {
            error: "Texting is not set up for this business yet.",
            reason: "not_configured",
          },
          { status: 503 },
        )
      }
      const message = err instanceof Error ? err.message : "Send failed"
      return NextResponse.json({ error: message, reason: "send_failed" }, { status: 502 })
    }
  },
)
